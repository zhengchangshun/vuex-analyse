import applyMixin from './mixin'
import devtoolPlugin from './plugins/devtool'
import ModuleCollection from './module/module-collection'
import { forEachValue, isObject, isPromise, assert, partial } from './util'

let Vue // bind on install

// new Vuex.Store(options) 执行Store类的构造函数  -- 顶层仓库
export class Store {
  constructor (options = {}) {
    // Auto install if it is not done yet and `window` has `Vue`.
    // To allow users to avoid auto-installation in some cases,
    // this code should be placed here. See #731
    // 如果是通过script标签引入的，自动注册
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }

    // dev waring 忽略
    if (__DEV__) {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }

    // 入参处理 插件：plugin， 严格模式： strict
    const {
      plugins = [],
      strict = false
    } = options

    // store internal state
    // 初始化
    this._committing = false
    this._actions = Object.create(null)  // 存储action，按照namespace的划分
    this._actionSubscribers = []  // 存放 订阅 store 的 action
    this._mutations = Object.create(null)  // 存储mutation，按照namespace的划分
    this._wrappedGetters = Object.create(null)   // 存储getter，按照namespace的划分
    // 完成了所有module、嵌套module的注册，并通过定义的key做区分
    /* 结构如下：
      'root': {
        'runtime': false,
        //子 module
        '_children': {
          // module的名称
          'moduleName': {
            'runtime': false,
            '_children': {},   //子 module
            '_rawModule': {},  //当前 module定义是的内容
            'state': {}, //当前 module定义是的state
          }
        },
        '_rawModule': {} //Vue.Store(options) --- options
        'state': {}, //options中的state
      }
    }*/
    this._modules = new ModuleCollection(options)
    this._modulesNamespaceMap = Object.create(null)
    this._subscribers = []  // 存放 订阅 store 的 mutation
    this._watcherVM = new Vue()
    this._makeLocalGettersCache = Object.create(null)

    // bind commit and dispatch to self
    const store = this
    const { dispatch, commit } = this

    // dispatch执行时，将内部的this指向当前的store
    this.dispatch = function boundDispatch (type, payload) {
      return dispatch.call(store, type, payload)
    }
    // commit执行时，将内部的this指向当前的store
    this.commit = function boundCommit (type, payload, options) {
      return commit.call(store, type, payload, options)
    }

    // strict mode
    this.strict = strict

    // 最顶层state： rootState
    const state = this._modules.root.state

    // init root module.
    // this also recursively registers all sub-modules
    // and collects all module getters inside this._wrappedGetters
    // 初始化module ，全局的模块（root）
    installModule(this, state, [], this._modules.root)
    // initialize the store vm, which is responsible for the reactivity
    // (also registers _wrappedGetters as computed properties)

    resetStoreVM(this, state)

    // apply plugins
    // 插件注册，对每个插件注入store实例，则插件中可以调用 dispatch、registerModule、subscribe 等实例方法
    plugins.forEach(plugin => plugin(this))

    // vuex devtool的处理
    const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
    if (useDevtools) {
      devtoolPlugin(this)
    }
  }

  // 获取state
  get state () {
    return this._vm._data.$$state
  }

  // 设置state无效
  set state (v) {
    if (__DEV__) {
      assert(false, `use store.replaceState() to explicit replace store state.`)
    }
  }

  // 订阅 store 的 mutation。handler 会在每个 mutation 完成后调用，接收 mutation 和经过 mutation 后的状态作为参数
  commit (_type, _payload, _options) {
    // check object-style commit
    // 类型检查
    const {
      type,
      payload,
      options
    } = unifyObjectStyle(_type, _payload, _options)

    const mutation = { type, payload }
    // 根据type值，获取对于的mutation方法。
    const entry = this._mutations[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown mutation type: ${type}`)
      }
      return
    }
    this._withCommit(() => {
      // 执行mutation方法
      entry.forEach(function commitIterator (handler) {
        handler(payload)
      })
    })

    // mutation执行后，state发生变化，通知订阅，依次执行 sub(mutation, this.state)
    this._subscribers
      .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
    // 此处用slice进行subs的浅拷贝。是因为订阅方法 genericSubscribe 中返回的订阅方法体中，执行时调用了 splice 方法，会影响原始数组。
    // 如果不做拷贝会影响 this._subscribers的值，从而导致其他mutation执行时，导致对应的订阅无效
      .forEach(sub => sub(mutation, this.state))

    if (
      __DEV__ &&
      options && options.silent
    ) {
      console.warn(
        `[vuex] mutation type: ${type}. Silent option has been removed. ` +
        'Use the filter functionality in the vue-devtools'
      )
    }
  }

  // 针对action的操作 ：handler 会在每个 action 分发的时候调用并接收 action 描述和当前的 store 的 state 这两个参数
  // 从 3.1.0 起 ：可以指定订阅处理函数的被调用时机应该在一个 action 分发之前还是之后 (默认行为是之前)
  /*
  store.subscribeAction({
    before: (action, state) => {
      console.log(`before action ${action.type}`)
    },
    after: (action, state) => {
      console.log(`after action ${action.type}`)
    }
  })*/

  dispatch (_type, _payload) {
    // check object-style dispatch
    // 类型检查
    const {
      type,
      payload
    } = unifyObjectStyle(_type, _payload)

    const action = { type, payload }
    // 从_action中获取对应的action方法
    const entry = this._actions[type]
    if (!entry) {
      if (__DEV__) {
        console.error(`[vuex] unknown action type: ${type}`)
      }
      return
    }

    // 以下通过slice方法做浅拷贝，原因同commit方法，是因为订阅方法 genericSubscribe 中返回的订阅方法体中，执行时调用了 splice 方法，会影响原始数组。
    try {
      // 执行_actionSubscribers订阅中的额before 部分
      this._actionSubscribers
        .slice() // shallow copy to prevent iterator invalidation if subscriber synchronously calls unsubscribe
        .filter(sub => sub.before)
        .forEach(sub => sub.before(action, this.state))
    } catch (e) {
      if (__DEV__) {
        console.warn(`[vuex] error in before action subscribers: `)
        console.error(e)
      }
    }

    // 执行action 对应的 handel
    const result = entry.length > 1
      ? Promise.all(entry.map(handler => handler(payload)))
      : entry[0](payload)

    // action执行后返回promise
    return new Promise((resolve, reject) => {
      result.then(res => {
        try {
          // 执行_actionSubscribers 订阅中的 after 部分
          this._actionSubscribers
            .filter(sub => sub.after)
            .forEach(sub => sub.after(action, this.state))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in after action subscribers: `)
            console.error(e)
          }
        }
        resolve(res)
      }, error => {
        // result执行结果返回reject时，执行如下部分，执行  _actionSubscribers 中的 error 部分
        try {
          this._actionSubscribers
            .filter(sub => sub.error)
            .forEach(sub => sub.error(action, this.state, error))
        } catch (e) {
          if (__DEV__) {
            console.warn(`[vuex] error in error action subscribers: `)
            console.error(e)
          }
        }
        reject(error)
      })
    })
  }

  // 添加store中的motation的订阅
  subscribe (fn, options) {
    return genericSubscribe(fn, this._subscribers, options)
  }

  // 添加store中的action的订阅，默认添加before
  subscribeAction (fn, options) {
    const subs = typeof fn === 'function' ? { before: fn } : fn
    return genericSubscribe(subs, this._actionSubscribers, options)
  }

  watch (getter, cb, options) {
    if (__DEV__) {
      assert(typeof getter === 'function', `store.watch only accepts a function.`)
    }
    return this._watcherVM.$watch(() => getter(this.state, this.getters), cb, options)
  }

  // 更换state
  replaceState (state) {
    this._withCommit(() => {
      this._vm._data.$$state = state
    })
  }

  // 动态注册module - 调用installModule方法，递归实现state、action、mutation、getter根据各自的namespace注册
  registerModule (path, rawModule, options = {}) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
      assert(path.length > 0, 'cannot register the root module by using registerModule.')
    }

    debugger
    this._modules.register(path, rawModule)
    // 调用installModule方法，递归实现state、action、mutation、getter根据各自的namespace注册
    installModule(this, this.state, path, this._modules.get(path), options.preserveState)
    // reset store to update getters...
    resetStoreVM(this, this.state)
  }

  // 卸载动态module
  unregisterModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    this._modules.unregister(path)  // 卸载模块
    this._withCommit(() => {
      const parentState = getNestedState(this.state, path.slice(0, -1))
      // 删除 Vue中的实例监听
      Vue.delete(parentState, path[path.length - 1])
    })
    resetStore(this)
  }

  // 是否存在module
  hasModule (path) {
    if (typeof path === 'string') path = [path]

    if (__DEV__) {
      assert(Array.isArray(path), `module path must be a string or an Array.`)
    }

    return this._modules.isRegistered(path)
  }

  // 热更新
  hotUpdate (newOptions) {
    this._modules.update(newOptions)
    resetStore(this, true)
  }

  // 是否正在commit
  _withCommit (fn) {
    const committing = this._committing
    this._committing = true
    fn()
    this._committing = committing
  }
}

// 默认情况下，新的处理函数会被添加到其链的尾端，因此它会在其它之前已经被添加了的处理函数之后执行。
// 这一行为可以通过向 options 添加 prepend: true 来覆写，即把处理函数添加到其链的最开始。
// 发布 - 订阅模式，通过 subs (this._subscribers) 收集订阅。
function genericSubscribe (fn, subs, options) {
  if (subs.indexOf(fn) < 0) {
    options && options.prepend
      ? subs.unshift(fn)
      : subs.push(fn)
  }
  return () => {
    const i = subs.indexOf(fn)
    // 执行订阅后，从当前队列subs中删除当前fn、
    if (i > -1) {
      subs.splice(i, 1)
    }
  }
}

function resetStore (store, hot) {
  store._actions = Object.create(null)
  store._mutations = Object.create(null)
  store._wrappedGetters = Object.create(null)
  store._modulesNamespaceMap = Object.create(null)
  const state = store.state
  // init all modules
  installModule(store, state, [], store._modules.root, true)
  // reset vm
  resetStoreVM(store, state, hot)
}

function resetStoreVM (store, state, hot) {
  const oldVm = store._vm

  // bind store public getters
  store.getters = {}
  // reset local getters cache
  store._makeLocalGettersCache = Object.create(null)
  const wrappedGetters = store._wrappedGetters
  const computed = {}
  forEachValue(wrappedGetters, (fn, key) => {
    // use computed to leverage its lazy-caching mechanism
    // direct inline function use will lead to closure preserving oldVm.
    // using partial to return function with only arguments preserved in closure environment.
    computed[key] = partial(fn, store)
    // 将wrappedGetters的属性定义到store.getter中 ,其中get方法从 vue实例的compute中获取
    // 保证了外部获取getter时，其实是获取vue实例的属性，通过Vue的特性实现getter的响应式数据
    Object.defineProperty(store.getters, key, {
      get: () => store._vm[key],
      enumerable: true // for local getters
    })
  })

  // use a Vue instance to store the state tree
  // suppress warnings just in case the user has added
  // some funky global mixins
  const silent = Vue.config.silent
  Vue.config.silent = true
  // store.vm被定义为Vue的实例，其中computed的属性定义为 partial(fn, store) ===》  fn(store)
  store._vm = new Vue({
    data: {
      $$state: state
    },
    computed
  })
  Vue.config.silent = silent

  // enable strict mode for new vm
  if (store.strict) {
    enableStrictMode(store)
  }

  if (oldVm) {
    if (hot) {
      // dispatch changes in all subscribed watchers
      // to force getter re-evaluation for hot reloading.
      store._withCommit(() => {
        oldVm._data.$$state = null
      })
    }
    Vue.nextTick(() => oldVm.$destroy())
  }
}

// 第一次调用的时候 store 即为当前的store实例， rootState 为 rootState（顶层state），path为[]， module 为rootModule（顶层module）
// 第二次调用的时候 store 即为当前的store实例， rootState 为 rootState（顶层state），path为['moduleName'], module 为 子module
function installModule (store, rootState, path, module, hot) {
  const isRoot = !path.length
  const namespace = store._modules.getNamespace(path)  // 根据path（key的集合）逐级拼接key值，形成namespace

  // register in namespace map
  // 添加 _modulesNamespaceMap 属性，存储当前module
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && __DEV__) {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // 对于嵌套module的state的处理
  if (!isRoot && !hot) {
    // 获取当前module的父module的state的值 rootState
    const parentState = getNestedState(rootState, path.slice(0, -1))
    const moduleName = path[path.length - 1]
    store._withCommit(() => {
      if (__DEV__) {
        if (moduleName in parentState) {
          console.warn(
            `[vuex] state field "${moduleName}" was overridden by a module with the same name at "${path.join('.')}"`
          )
        }
      }
      // 在父module的state中添加属性 moduleName（key），值为当前module的state
      /* 设置成如下格式:
      root:{
        state:{
          //moduleName定义的state
          moduleName1: {
             moduleName2:{}  //moduleName2定义的state
          },
        }
      }*/
      // state的响应式处理： 构造的state通过Vue.set方法设置之后，就会变成响应式。
      Vue.set(parentState, moduleName, module.state)
    })
  }

  // 给module添加context属性，包含 dispatch, commit方法，并设置的劫持
  const local = module.context = makeLocalContext(store, namespace, path)

  // 遍历注册module中的mutation - 根据module的 [nameSpace + key] 作为key来区分mutation
  // 形式：
  // _mutations:{
  //   'namespace/mutationName':function(){}
  // }
  module.forEachMutation((mutation, key) => {
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  // 遍历注册module中的action - 根据module的 [nameSpace + key] 作为key来区分action
  // 形式：
  // _actions:{
  //   'namespace/actionName':function(){}
  // }
  module.forEachAction((action, key) => {
    // key：函数名称
    // action的存储形式， mutation、getter类似
    // 如果存在namespace，则在store._aciton中存储为：
    // _aciton:{
    //   namespace/handelName:function(){}
    // }
    // 如果不存在nameSpace：
    // _aciton:{
    //   handelName:function(){}
    // }
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  // 遍历注册module中的getter - 根据module的 [nameSpace + key] 作为key来区分getter
  // 形式：
  // _wrappedGetters:{
  //   'namespace/getterName':function(){}
  // }
  module.forEachGetter((getter, key) => {
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  // 递归处理嵌套的 module （通过module初始化的时候，_children属性来查找）
  // rootState 传入递归函数，保证所有的state修改都在rootState上操作
  // 深度遍历
  module.forEachChild((child, key) => {
    installModule(store, rootState, path.concat(key), child, hot)
  })
}

/**
 * make localized dispatch, commit, getters and state
 * if there is no namespace, just use root ones
 */
// 构造context对象，提供 dispatch、commit、getter、state等属性（当前模块内的属性） - 通过store属性得到
function makeLocalContext (store, namespace, path) {
  const noNamespace = namespace === ''

  // 因为registerAction方法将action都根据（nameSpace + handlerName）都注册到store._action属性上；
  // 如果不存在nameSpace，则方法名称就是handlerName
  // 如果存在nameSpece，则需要将type转化为：'namespace + type'
  // store.dispatch 最终都是在store._actions中查找对应的方法名称
  const local = {
    dispatch: noNamespace ? store.dispatch : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      // options 不存在 或者  options.root 不为ture，则标识从子模块中获取 action。否则从root中操作
      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._actions[type]) {
          console.error(`[vuex] unknown local action type: ${args.type}, global type: ${type}`)
          return
        }
      }

      return store.dispatch(type, payload)
    },

    // commit的同dispatch ，也是根据 namespace 区分对应的type，然后在 store._mutations 中找到对应的方法执行
    commit: noNamespace ? store.commit : (_type, _payload, _options) => {
      const args = unifyObjectStyle(_type, _payload, _options)
      const { payload, options } = args
      let { type } = args

      // options 不存在 或者  options.root 不为ture, 则标识从子模块中获取mutation，否则从root中操作
      if (!options || !options.root) {
        type = namespace + type
        if (__DEV__ && !store._mutations[type]) {
          console.error(`[vuex] unknown local mutation type: ${args.type}, global type: ${type}`)
          return
        }
      }

      store.commit(type, payload, options)
    }
  }

  // getters and state object must be gotten lazily
  // because they will be changed by vm update
  Object.defineProperties(local, {
    getters: {
      get: noNamespace
        ? () => store.getters
        : () => makeLocalGetters(store, namespace)
    },
    state: {
      get: () => getNestedState(store.state, path)
    }
  })

  return local
}

function makeLocalGetters (store, namespace) {
  if (!store._makeLocalGettersCache[namespace]) {
    const gettersProxy = {}
    const splitPos = namespace.length
    Object.keys(store.getters).forEach(type => {
      // skip if the target getter is not match this namespace
      if (type.slice(0, splitPos) !== namespace) return

      // extract local getter type
      const localType = type.slice(splitPos)

      // Add a port to the getters proxy.
      // Define as getter property because
      // we do not want to evaluate the getters in this time.
      Object.defineProperty(gettersProxy, localType, {
        get: () => store.getters[type],
        enumerable: true
      })
    })
    store._makeLocalGettersCache[namespace] = gettersProxy
  }

  return store._makeLocalGettersCache[namespace]
}

// 注册Mutation - mutation 按照（namespace + handelName） 维护在 store._mutation对象上
function registerMutation (store, type, handler, local) {
  const entry = store._mutations[type] || (store._mutations[type] = [])
  entry.push(function wrappedMutationHandler (payload) {
    // 注入了当前module下的state
    handler.call(store, local.state, payload)
  })
}

// 注册Action - action 按照 type（namespace + handelName -- 形如： a/b/ ） 维护在 store._action对象上，
// 并在执行时 注入了 context 和 root的属性
function registerAction (store, type, handler, local) {
  const entry = store._actions[type] || (store._actions[type] = [])
  entry.push(function wrappedActionHandler (payload) {
    // 注入了当前module的context（local）的属性，以及root （store）的属性
    let res = handler.call(store, {
      dispatch: local.dispatch,
      commit: local.commit,
      getters: local.getters,
      state: local.state,
      rootGetters: store.getters,
      rootState: store.state
    }, payload)
    if (!isPromise(res)) {
      res = Promise.resolve(res)
    }
    if (store._devtoolHook) {
      return res.catch(err => {
        store._devtoolHook.emit('vuex:error', err)
        throw err
      })
    } else {
      return res
    }
  })
}

// 注册Getter  - getter 按照（namespace + handelName） 维护在 store._wrappedGetters对象上，并在执行时 注入了 context 和 root的属性
function registerGetter (store, type, rawGetter, local) {
  // 重复定义了getter
  if (store._wrappedGetters[type]) {
    if (__DEV__) {
      console.error(`[vuex] duplicate getter key: ${type}`)
    }
    return
  }
  store._wrappedGetters[type] = function wrappedGetter (store) {
    return rawGetter(
      local.state, // local state
      local.getters, // local getters
      store.state, // root state
      store.getters // root getters
    )
  }
}

function enableStrictMode (store) {
  store._vm.$watch(function () { return this._data.$$state }, () => {
    if (__DEV__) {
      assert(store._committing, `do not mutate vuex store state outside mutation handlers.`)
    }
  }, { deep: true, sync: true })
}

// 逐层通过key获取当前的state
function getNestedState (state, path) {
  return path.reduce((state, key) => state[key], state)
}

// 针对 commit、dispatch的两种使用方式，做统一格式处理
// 方式1：
// store.commit('increment', {
//   amount: 10
// })
//
// 方式2：
// store.commit({
//   type: 'increment',
//   amount: 10
// })

function unifyObjectStyle (type, payload, options) {
  if (isObject(type) && type.type) {
    options = payload
    payload = type  // 此时整个对象都赋值给payload，要获取参数，则需要使用 payload[key]的方式获取
    type = type.type
  }

  if (__DEV__) {
    assert(typeof type === 'string', `expects string as the type, but found ${typeof type}.`)
  }

  return { type, payload, options }
}

export function install (_Vue) {
  // 如果 Vuex已经注册，则return
  if (Vue && _Vue === Vue) {
    // dev环境下warning忽视
    if (__DEV__) {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue
  applyMixin(Vue)
}
