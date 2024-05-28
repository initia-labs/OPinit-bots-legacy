import { Context, Next } from 'koa'
import { Prometheus } from './metrics'

export const metricsMiddleware = (functionName: string) => {
  return async (ctx: Context, next: Next) => {
    const end = Prometheus.startLatencyTimer(functionName)
    Prometheus.startStatusCodeCounter(functionName)

    Prometheus.add({
      name: Prometheus.StatusCodeCounterMetricsName(functionName),
      data: 1,
      labels: { status_code: String(ctx.status) }
    })

    await next()

    const startHrTime = process.hrtime()
    const durationInMilliseconds = process.hrtime(startHrTime)[1] / 1e6

    Prometheus.add({
      name: Prometheus.LatencyTimerMetricsName(functionName),
      data: durationInMilliseconds
    })

    end()
  }
}

export const wrapControllerFunction = (functionName: string, controllerFunction: (ctx: Context) => Promise<void>) => {
  return async (ctx: Context) => {
    await metricsMiddleware(functionName)(ctx, async () => {
      await controllerFunction(ctx)
    })
  }
}
