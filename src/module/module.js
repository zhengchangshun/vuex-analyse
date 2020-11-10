import { forEachValue } from '../util'

// Base data struct for store's module, package with some attribute and method
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    // Store some children item
    // 用于存放module内容
    this._children = Object.create(null)
    // Store the origin module object which passed by programmer
    // 当前module ，结构 {state,mutation,action,getter}
    this._rawModule = rawModule
    // 当前module 的state
    const rawState = rawModule.state

    // Store the origin module's state
    // 如果state是函数，就执行，否则直接返回，结果赋值给当前实例this的state属性
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
    // 返回一个对象包含runtime、_children、_rawModule、state 四个属性
  }

  get namespaced () {
    return !!this._rawModule.namespaced
  }

  // 新增module
  addChild (key, module) {
    this._children[key] = module
  }

  removeChild (key) {
    delete this._children[key]
  }

  // 获取对于key值得module - 通过这个方法将各个层级的module串联起来
  getChild (key) {
    return this._children[key]
  }

  hasChild (key) {
    return key in this._children
  }

  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }

  forEachChild (fn) {
    forEachValue(this._children, fn)
  }

  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }

  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }

  forEachMutation (fn) {
    // 当前module的mutation对象
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
