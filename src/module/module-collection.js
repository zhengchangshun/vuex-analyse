import Module from './module'
import { assert, forEachValue } from '../util'

export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    // 注册 root module - rawRootModule 为： new Vuex.Store(options) 中的options
    this.register([], rawRootModule, false)
  }

  get (path) {
    // 从root，逐层module调用getChild方法 -  获取对于key值得module
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) {
    let module = this.root
    // 循环遍历module的moduleName（key）,并拼接成最终的namespace
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  // rawModule 结构为 {state,mutation,action}
  // 对于rootModule来说，就是Vuex.Store实例化时的参数
  // 对于嵌套模块来说，就是嵌套的module内容
  register (path, rawModule, runtime = true) {
    if (__DEV__) {
      assertRawModule(path, rawModule)
    }

    // 返回newModule对象包含runtime、_children（存放嵌套的module）、_rawModule（当前module）、state（当前module的state） 四个属性
    const newModule = new Module(rawModule, runtime)
    // 是否是顶层module（root），如果是则root内容指向，当前module内容。
    if (path.length === 0) {
      this.root = newModule
    } else {
      // path.slice(0, -1) : 返回一个新数组，去掉最后一个元素
      // 返回当前module的上一级module(父级module)
      const parent = this.get(path.slice(0, -1))
      // 在父级module上的 _children 中添加当前module，key为当前module的定义时的key
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    // 针对嵌套的modules的处理 - 循环递归处理
    if (rawModule.modules) {
      // rawChildModule： 子module， key：module的key值
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        // 注册子模块
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    const child = parent.getChild(key)

    if (!child) {
      if (__DEV__) {
        console.warn(
          `[vuex] trying to unregister module '${key}', which is ` +
          `not registered`
        )
      }
      return
    }

    if (!child.runtime) {
      return
    }

    parent.removeChild(key)
  }

  isRegistered (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]

    return parent.hasChild(key)
  }
}

function update (path, targetModule, newModule) {
  if (__DEV__) {
    assertRawModule(path, newModule)
  }

  // update target module
  targetModule.update(newModule)

  // update nested modules
  if (newModule.modules) {
    for (const key in newModule.modules) {
      if (!targetModule.getChild(key)) {
        if (__DEV__) {
          console.warn(
            `[vuex] trying to add a new module '${key}' on hot reloading, ` +
            'manual reload is needed'
          )
        }
        return
      }
      update(
        path.concat(key),
        targetModule.getChild(key),
        newModule.modules[key]
      )
    }
  }
}

const functionAssert = {
  assert: value => typeof value === 'function',
  expected: 'function'
}

const objectAssert = {
  assert: value => typeof value === 'function' ||
    (typeof value === 'object' && typeof value.handler === 'function'),
  expected: 'function or object with "handler" function'
}

const assertTypes = {
  getters: functionAssert,
  mutations: functionAssert,
  actions: objectAssert
}

function assertRawModule (path, rawModule) {
  Object.keys(assertTypes).forEach(key => {
    if (!rawModule[key]) return

    const assertOptions = assertTypes[key]

    forEachValue(rawModule[key], (value, type) => {
      assert(
        assertOptions.assert(value),
        makeAssertionMessage(path, key, type, value, assertOptions.expected)
      )
    })
  })
}

function makeAssertionMessage (path, key, type, value, expected) {
  let buf = `${key} should be ${expected} but "${key}.${type}"`
  if (path.length > 0) {
    buf += ` in module "${path.join('.')}"`
  }
  buf += ` is ${JSON.stringify(value)}.`
  return buf
}
