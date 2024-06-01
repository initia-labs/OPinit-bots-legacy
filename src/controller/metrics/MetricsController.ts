import { Context } from 'koa'
import { KoaController, Get, Controller } from 'koa-joi-controllers'
import { routeConfig } from 'koa-swagger-decorator'
import { Prometheus } from '../../lib/metrics'

// @Controller('')
export class MetricsController extends KoaController {
  @routeConfig({
    method: 'get',
    path: '/metrics',
    tags: ['Metrics']
  })
  @Get('/metrics')
  async getMetrics(ctx: Context): Promise<void> {
    try {
      const metricsData = await Prometheus.get()
      ctx.status = 200
      ctx.set('Content-Type', metricsData.contentType)
      ctx.body = metricsData.metrics
    } catch (e) {
      ctx.status = 500
      ctx.body = 'Failed to retrieve metrics'
      console.error('Error fetching Prometheus metrics:', e)
    }
  }
}
