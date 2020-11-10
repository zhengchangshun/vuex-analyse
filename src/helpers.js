import { isObject } from './util'

/**
 * Reduce the code which written in Vue.js for getting the state.
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} states # Object's item can be a function which accept state and getters for param, you can do something for state and getters in it.
 * @param {Object}
 */

// state的引用方式如下两种：
// （1） mapState({ products: state => state.products.all } 或者   mapState(namespace，{ products: state => state.products.all }
//     被normalizeNamespace转换成 ==》 mapState(namespace='',{ products: state => state.products.all })
// （2）mapState('products','all')
// 最终统一为格式：mapState(namespace, states)
export const mapState = normalizeNamespace((namespace, states) => {
  const res = {}
  if (__DEV__ && !isValidMap(states)) {
    console.error('[vuex] mapState: mapper parameter must be either an Array or an Object')
  }

  // 经过normalizeMap处理后，state变为：
  // mapState('products','all') ===》 {key:'all',val:'all'}
  // mapState('',{ products: state => state.products.all }) ===》 {key:'products',val:state => state.products.all }}
  normalizeMap(states).forEach(({ key, val }) => {
    // 返回一个 key :function(){}的形式，跟vue中computed的属性一致，在真正使用该属性是触发下边的计算方法
    res[key] = function mappedState () {
      let state = this.$store.state
      let getters = this.$store.getters
      // 如果存在namespace，则state、getter被设置为当前module下的state和getter，否则为root下的state和getter
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapState', namespace)
        if (!module) {
          return
        }
        state = module.context.state
        getters = module.context.getters
      }

      // 如果是function，则注入参数 state，getter （当前module下），
      // 如果是字符串。则直接在当前state中获取对应值返回
      return typeof val === 'function'
        ? val.call(this, state, getters)
        : state[val]
    }
    // mark vuex getter for devtools
    // 添加 vuex 属性，devtool使用
    res[key].vuex = true
  })
  // 返回的是一个对象,作为computed的子项，在vue真正使用该属性时，执行上述的 mappedState 方法
  return res
})

/**
 * Reduce the code which written in Vue.js for committing the mutation
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} mutations # Object's item can be a function which accept `commit` function as the first param, it can accept anthor params. You can commit mutation and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
// mutation的引用方式：mapMutations('cart', ['addProductToCart'])

export const mapMutations = normalizeNamespace((namespace, mutations) => {
  const res = {}
  if (__DEV__ && !isValidMap(mutations)) {
    console.error('[vuex] mapMutations: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(mutations).forEach(({ key, val }) => {
    res[key] = function mappedMutation (...args) {
      // Get the commit method from store
      let commit = this.$store.commit
      // 如果存在namespace，则将commit设置为module中的commit方法
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapMutations', namespace)
        if (!module) {
          return
        }
        commit = module.context.commit
      }

      // 真正执行mutation时,通过commit提交.
      return typeof val === 'function'
        ? val.apply(this, [commit].concat(args))
        : commit.apply(this.$store, [val].concat(args))
    }
  })

  // 返回一个对象,注入到methods,同普通方法一致
  return res
})

/**
 * Reduce the code which written in Vue.js for getting the getters
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} getters
 * @return {Object}
 */
// mapGetters 的使用同mapState一致
// mapState({ a: state => state.some.nested.module.a})
// 根据namespace从store.getter中获取对于的computed属性
export const mapGetters = normalizeNamespace((namespace, getters) => {
  const res = {}
  if (__DEV__ && !isValidMap(getters)) {
    console.error('[vuex] mapGetters: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(getters).forEach(({ key, val }) => {
    // The namespace has been mutated by normalizeNamespace
    val = namespace + val
    res[key] = function mappedGetter () {
      if (namespace && !getModuleByNamespace(this.$store, 'mapGetters', namespace)) {
        return
      }
      if (__DEV__ && !(val in this.$store.getters)) {
        console.error(`[vuex] unknown getter: ${val}`)
        return
      }
      return this.$store.getters[val]
    }
    // mark vuex getter for devtools
    res[key].vuex = true
  })
  return res
})

/**
 * Reduce the code which written in Vue.js for dispatch the action
 * @param {String} [namespace] - Module's namespace
 * @param {Object|Array} actions # Object's item can be a function which accept `dispatch` function as the first param, it can accept anthor params. You can dispatch action and do any other things in this function. specially, You need to pass anthor params from the mapped function.
 * @return {Object}
 */
// action的引用方式：mapActions('cart', ['addProductToCart'])
export const mapActions = normalizeNamespace((namespace, actions) => {
  const res = {}
  if (__DEV__ && !isValidMap(actions)) {
    console.error('[vuex] mapActions: mapper parameter must be either an Array or an Object')
  }
  normalizeMap(actions).forEach(({ key, val }) => {
    res[key] = function mappedAction (...args) {
      // get dispatch function from store
      let dispatch = this.$store.dispatch
      // 如果存在namespace,则将dispatch设置为module中的dispatch，否则为root的dispatch
      if (namespace) {
        const module = getModuleByNamespace(this.$store, 'mapActions', namespace)
        if (!module) {
          return
        }
        dispatch = module.context.dispatch
      }
      // 真正调用时，通过dispatch去触发action操作。
      return typeof val === 'function'
        ? val.apply(this, [dispatch].concat(args))
        : dispatch.apply(this.$store, [val].concat(args))
    }
  })

  // 返回一个对象,注入到methods,同普通方法一致
  return res
})

/**
 * Rebinding namespace param for mapXXX function in special scoped, and return them by simple object
 * @param {String} namespace
 * @return {Object}
 */

// 统一设置namespace
export const createNamespacedHelpers = (namespace) => ({
  mapState: mapState.bind(null, namespace),
  mapGetters: mapGetters.bind(null, namespace),
  mapMutations: mapMutations.bind(null, namespace),
  mapActions: mapActions.bind(null, namespace)
})

/**
 * Normalize the map
 * normalizeMap([1, 2, 3]) => [ { key: 1, val: 1 }, { key: 2, val: 2 }, { key: 3, val: 3 } ]
 * normalizeMap({a: 1, b: 2, c: 3}) => [ { key: 'a', val: 1 }, { key: 'b', val: 2 }, { key: 'c', val: 3 } ]
 * @param {Array|Object} map
 * @return {Object}
 * 系列化map，统一格式为{key:val}, 如果是数组则val - key，如果是对象，val： map[key]
 * 主要是因为 mapState、mapAction等支持数组和对象的两种引用方式。统一格式
 * ...mapActions(['increment']),
 * ...mapActions({add: 'increment'})
 */
function normalizeMap (map) {
  if (!isValidMap(map)) {
    return []
  }
  return Array.isArray(map)
    ? map.map(key => ({ key, val: key }))
    : Object.keys(map).map(key => ({ key, val: map[key] }))
}

/**
 * Validate whether given map is valid or not
 * @param {*} map
 * @return {Boolean}
 * 检查map是否是数组或者对象
 */
function isValidMap (map) {
  return Array.isArray(map) || isObject(map)
}

/**
 * Return a function expect two param contains namespace and map. it will normalize the namespace and then the param's function will handle the new namespace and the map.
 * @param {Function} fn
 * @return {Function}
 * 针对 mapState、mapActions等引入方式进行格式统一，统一处理namespace的
 * mapState(state=>({}))
 * mapAction('nameSpace',['action'])
 */
function normalizeNamespace (fn) {
  return (namespace, map) => {
    if (typeof namespace !== 'string') {
      // 针对传入的function的处理。例如：mapState(state=>({}))
      map = namespace
      namespace = ''
    } else if (namespace.charAt(namespace.length - 1) !== '/') { // 针对传入的String的处理，例如 mapAction('nameSpace',['action'])
      namespace += '/'
    }
    return fn(namespace, map)
  }
}

/**
 * Search a special module from store by namespace. if module not exist, print error message.
 * @param {Object} store
 * @param {String} helper
 * @param {String} namespace
 * @return {Object}
 * 通过namespace获取对于的模块。 namespace 为 拼接的各个层级的namespace
 */
function getModuleByNamespace (store, helper, namespace) {
  const module = store._modulesNamespaceMap[namespace]
  if (__DEV__ && !module) {
    console.error(`[vuex] module namespace not found in ${helper}(): ${namespace}`)
  }
  return module
}
