import { APIRequester } from 'initia-l1'
import http from 'http'
import https from 'https'

class APIRequesterSingleton {
  private static instances: { [key: string]: APIRequester } = {}

  private constructor() {}

  public static getInstance(uri: string): APIRequester {
    if (!APIRequesterSingleton.instances[uri]) {
      APIRequesterSingleton.instances[uri] = new APIRequester(uri, {
        httpAgent: new http.Agent({ keepAlive: true }),
        httpsAgent: new https.Agent({ keepAlive: true })
      })
    }
    return APIRequesterSingleton.instances[uri]
  }
}

export default APIRequesterSingleton
