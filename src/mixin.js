export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])

  // 对 Vue 2x 及以上版本的处理
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // override init and inject vuex init procedure
    // for 1.x backwards compatibility.
    // aop,改写Vue实例的_init方法
    const _init = Vue.prototype._init
    Vue.prototype._init = function (options = {}) {
      options.init = options.init
        ? [vuexInit].concat(options.init)
        : vuexInit
      _init.call(this, options)
    }
  }

  /**
   * Vuex init hook, injected into each instances init hooks list.
   */

  // 在beforeCreate生命周期时，执行store（new Vuex.Store()生成的），并给每个组件注入 this.$store 属性
  function vuexInit () {
    const options = this.$options
    // store injection
    // 通options.store 即通过 new Vuex.Store()后返回的对象
    // 返回格式如下：
    /* {
      commit:function f(){},
      dispatch: function f(){},
      _actions: {},
      _mutations: {},
      _wrappedGetters: {},
      _modules: {},
      //.....
    }*/
    if (options.store) {
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      this.$store = options.parent.$store
    }
  }
}
