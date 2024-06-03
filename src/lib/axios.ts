import axios, { AxiosInstance } from 'axios';
import https from 'https';
import http from 'http';

class AxiosSingleton {
  private static instance: AxiosInstance;

  private constructor() {}

  public static getInstance(): AxiosInstance {
    if (!AxiosSingleton.instance) {
        AxiosSingleton.instance = axios.create({
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'initia-rollup'
        },
        httpsAgent: new https.Agent({ keepAlive: true }),
        httpAgent: new http.Agent({ keepAlive: true }),
      });
    }
    return AxiosSingleton.instance;
  }
}

export default AxiosSingleton;
