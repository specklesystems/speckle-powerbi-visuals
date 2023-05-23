import { createStore } from 'vuex'
import { SpeckleDataInput } from 'src/types'
export type InputState = 'valid' | 'incomplete' | 'invalid'

export interface SpeckleVisualState {
  input?: SpeckleDataInput
  status: InputState
}

// Create a new store instance.
export const store = createStore<SpeckleVisualState>({
  state() {
    return {
      input: null,
      status: 'incomplete'
    }
  },
  mutations: {
    setInput(state, input?: SpeckleDataInput) {
      state.input = input
    },
    setStatus(state, status: InputState) {
      console.log('Setting status', status)
      state.status = status ?? 'invalid'
    },
    clearInput(state) {
      state.input = null
    }
  },
  actions: {
    update(context, status: InputState, input?: SpeckleDataInput) {
      context.commit('setInput', input)
      context.commit('setStatus', status)
    }
  }
})
