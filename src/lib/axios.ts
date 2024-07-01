import axios, { AxiosInstance } from 'axios'
import https from 'https'
import http from 'http'
import { config } from 'config'

class AxiosSingleton {
  private static instance: AxiosInstance

  private constructor() {}

  public static getInstance(): AxiosInstance {
    if (!AxiosSingleton.instance) {
      AxiosSingleton.instance = axios.create({
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'initia-rollup'
        },
        httpsAgent: new https.Agent({ keepAlive: config.ENABLE_KEEP_ALIVE }),
        httpAgent: new http.Agent({ keepAlive: config.ENABLE_KEEP_ALIVE })
      })
    }
    return AxiosSingleton.instance
  }
}

export default AxiosSingleton
