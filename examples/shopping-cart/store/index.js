import Vue from 'vue'
import Vuex from 'vuex'
import cart from './modules/cart'
import products from './modules/products'
import createLogger from '../../../src/plugins/logger'

Vue.use(Vuex)

const debug = process.env.NODE_ENV !== 'production'

export default new Vuex.Store({
  state: {
    rootState: 'rootState'
  },
  mutations: {
    rootMutation (state, payload) {
      state.value = payload
    }
  },
  actions: {
    rootAction ({ commit }, payload) {
      commit('updateValue', payload)
    }
  },
  getters: {
    rootGetter: state => state.rootState
  },
  modules: {
    cart,
    products
  },
  strict: debug,
  plugins: debug ? [createLogger()] : []
})
