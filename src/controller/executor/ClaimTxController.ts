import { Context } from 'koa'
import { KoaController, Get, Controller, Validator, Validate } from 'koa-joi-controllers'
import { ErrorTypes } from '../../lib/error'
import { error, success } from '../../lib/response'
import { getClaimTxList } from '../../service'
import { responses, routeConfig, z } from 'koa-swagger-decorator'
import { GetClaimResponse } from '../../swagger/executor_model'
import { wrapControllerFunction } from '../../lib/metricsMiddleware'
import { INIT_ACCOUNT_REGEX } from '../../lib/constants'

const Joi = Validator.Joi

@Controller('')
export class ClaimTxController extends KoaController {
  @routeConfig({
    method: 'get',
    path: '/tx/claim',
    summary: 'Get tx data for claiming',
    description: 'Get claim data',
    tags: ['Executor'],
    operationId: 'getClaimTx',
    request: {
      query: z.object({
        address: z.string().optional(),
        sequence: z.number().optional(),
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
  @responses(GetClaimResponse)
  @Validate({
    query: {
      address: Joi.string().optional().regex(INIT_ACCOUNT_REGEX).description('User address'),
      sequence: Joi.number().optional(),
      limit: Joi.number().optional().default(20),
      offset: Joi.number().optional().default(0),
      descending: Joi.boolean().optional().default(true)
    }
  })
  @Get('/tx/claim')
  async getClaimTxList(ctx: Context): Promise<void> {
    await wrapControllerFunction('get_claim_tx_list', async (ctx) => {
      const claimTxList = await getClaimTxList(ctx.query as any)
      if (claimTxList) success(ctx, claimTxList)
      else error(ctx, ErrorTypes.API_ERROR)
    })(ctx)
  }
}
