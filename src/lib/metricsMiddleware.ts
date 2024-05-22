import { Context, Next } from 'koa'
import { Prometheus, MetricName } from './metrics'

export const metricsMiddleware = (functionName: string) => {
  return async (ctx: Context, next: Next) => {
    const end = Prometheus.startLatencyTimer(functionName)
    Prometheus.startStatusCodeCounter(functionName)

    const startHrTime = process.hrtime()

    await next()

    const durationInMilliseconds = process.hrtime(startHrTime)[1] / 1e6
    Prometheus.add({
      name: MetricName.REQUEST_LATENCY_HISTOGRAM,
      data: durationInMilliseconds
    })

    Prometheus.add({
      name: MetricName.REQUEST_COUNT,
      data: 1
    })

    Prometheus.add({
      name: `${functionName}_${MetricName.REQUEST_STATUS_CODE_COUNTER}`,
      data: 1,
      labels: { status_code: String(ctx.status) }
    });

    end()
  }
}

export const wrapControllerFunction = (
  functionName: string,
  controllerFunction: (ctx: Context) => Promise<void>
) => {
  return async (ctx: Context, next: Next) => {
    await metricsMiddleware(functionName)(ctx, async () => {
      await controllerFunction(ctx)
    })
    await next()
  }
}
