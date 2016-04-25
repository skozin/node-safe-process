import co from 'co'
import Log from 'stupid-log'

export default { init, SignalAbortError }

/**
 * Params:
 *
 * - startup: () -> Promise void || () *-> void
 * - teardown: (err) -> Promise void || (err) *-> void
 * - name: String
 *
 * All parameters are optional.
 */
function init({
  startup, teardown,
  $startup, $teardown,
  startupTimeoutSec = 20,
  teardownTimeoutSec = 10,
  name = 'process', log
}) {
  log = log || Log.for(name)

  startup = startup || $startup || nop
  teardown = teardown || $teardown || nop

  let state = {
    exiting: false,
    teardown: teardownWithError,
    exitReason: undefined
  }

  process.on('uncaughtException', teardownWithError)

  let pStarted = co(function*() {
    yield Promise.delay(0)
    yield startup()
  })

  pStarted.then().timeout(1000 * startupTimeoutSec).then(x => {
    log('startup complete')
  })
  .catch(err => {
    log.error(`startup failed: ${ err && err.stack || err }`)
    teardownWithError(err)
  })

  exitOnSignal('SIGTERM')
  exitOnSignal('SIGINT')

  function exitOnSignal(signal) {
    process.on(signal, () => co($trap(signal)))
  }

  function* $trap(signal) {
    if (state.exiting) {
      return
    }

    state.exiting = true
    state.exitReason = new SignalAbortError(signal)

    log(`trapped ${ signal }, assuring startup complete...`)

    yield pStarted.catch(nop).timeout(1000 * teardownTimeoutSec).catch(x => {
      log.error(`startup couldn't complete in ${ teardownTimeoutSec } sec`)
    })

    teardownWithError(state.exitReason)
  }

  function teardownWithError(err) {
    co($teardownWithError(err)).timeout(1000 * teardownTimeoutSec).catch(err => {
      log.error(`teardown failed: ${ err && err.stack || err }`)
      process.exit(2)
    })
  }

  function* $teardownWithError(err) {
    log(`teardown, reason: ${ err ? (err.signal || err.stack || err) : 'normal exit' }`)

    state.exiting = true
    state.exitReason = err

    try {
      yield teardown(err)
    }
    catch (err) {
      log.error(`error during teardown: ${ err && err.stack || err }`)
    }

    process.nextTick(x => {
      log('teardown complete, exiting')
      process.exit(err === undefined ? 0 : 1)
    })
  }

  return state
}


function nop() {
  return Promise.resolve()
}


export function SignalAbortError(signal = 'unknown signal') {
  Error.call(this)
  Error.captureStackTrace(this, SignalAbortError)
  this.signal = signal
  this.message = `recieved ${ signal }`
  this.isSignalAbort = true
}

SignalAbortError.prototype = Object.create(Error.prototype)
