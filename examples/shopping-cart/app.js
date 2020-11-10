import Vue from 'vue'
import App from './components/App.vue'
import store from './store'
import { currency } from './currency'

Vue.filter('currency', currency)

// 测试动态注册 module - 如果多个namespace，形如 [namespace1,namespace2]
// 则namespace1必须是已经注册的module，依次类推，新注册的module必须注册在当前module （可以是root）之下
store.registerModule(['nested'], {
  namespaced: true,
  state: {
    registerModule: 'registerModule'
  },
  mutation: {
    registerModuleMutation ({ state, commit }) {
    }
  },
  action: {
    registerModuleAction (state, payload) {
    }
  }
})

new Vue({
  el: '#app',
  store,
  render: h => h(App)
})
