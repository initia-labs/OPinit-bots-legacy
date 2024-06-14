import { Context } from 'koa'
import {
  KoaController,
  Get,
  Controller,
  Validator,
  Validate
} from 'koa-joi-controllers'
import { ErrorTypes } from '../../lib/error'
import { error, success } from '../../lib/response'
import { responses, routeConfig, z } from 'koa-swagger-decorator'
import { getOutputList } from '../../service'
import { GetOutputResponse } from '../../swagger/executor_model'
import { wrapControllerFunction } from '../../lib/metricsMiddleware'

const Joi = Validator.Joi

@Controller('')
export class OutputController extends KoaController {
  @routeConfig({
    method: 'get',
    path: '/output',
    summary: 'Get output proposal data',
    description: 'Get output proposal data',
    tags: ['Executor'],
    operationId: 'getOutput',
    request: {
      query: z.object({
        output_index: z.number().optional(),
        limit: z
          .number()
          .optional()
          .default(20)
          .refine((value) => [10, 20, 100, 500].includes(value), {
            message: 'Invalid limit value'
          }),
        offset: z.number().optional().default(0),
        descending: z.boolean().optional().default(true)
      })
    }
  })
  @responses(GetOutputResponse)
  @Validate({
    query: {
      output_index: Joi.number().optional(),
      limit: Joi.number().optional().default(20),
      offset: Joi.number().optional().default(0),
      descending: Joi.boolean().optional().default(true)
    }
  })
  @Get('/output')
  async getgetOutputList(ctx: Context): Promise<void> {
    await wrapControllerFunction('get_output_list', async (ctx) => {
      const outputList = await getOutputList(ctx.query as any)
      if (outputList) success(ctx, outputList)
      else error(ctx, ErrorTypes.API_ERROR)
    })(ctx)
  }
}
