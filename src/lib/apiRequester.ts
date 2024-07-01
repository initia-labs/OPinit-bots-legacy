import { APIRequester } from 'initia-l1'
import http from 'http'
import https from 'https'
import { config } from 'config'

class APIRequesterSingleton {
  private static instances: { [key: string]: APIRequester } = {}

  private constructor() {}

  public static getInstance(uri: string): APIRequester {
    if (!APIRequesterSingleton.instances[uri]) {
      APIRequesterSingleton.instances[uri] = new APIRequester(uri, {
        httpAgent: new http.Agent({ keepAlive: config.ENABLE_KEEP_ALIVE }),
        httpsAgent: new https.Agent({ keepAlive: config.ENABLE_KEEP_ALIVE })
      })
    }
    return APIRequesterSingleton.instances[uri]
  }
}

export default APIRequesterSingleton
