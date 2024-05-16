import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  Summary,
  register
} from 'prom-client'

type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary'

export enum MetricName {
  L1MonitorHeight = 'l1_monitor_height',
  L2MonitorHeight = 'l2_monitor_height',
  L1MonitorTime = 'l1_monitor_time',
  L2MonitorTime = 'l2_monitor_time'
}

interface CreateMetricOptions {
  type: MetricType;
  name: string;
  help: string;
}

interface AddMetricData {
  name: string;
  data: number;
}

const prometheus = () => {
  const registry = new Registry()
  const instances: Record<
    string,
    {
      type: MetricType;
      instance:
        | Counter<string>
        | Gauge<string>
        | Histogram<string>
        | Summary<string>;
    }
  > = {}

  const create = ({ type, name, help }: CreateMetricOptions): void => {
    let instance:
      | Counter<string>
      | Gauge<string>
      | Histogram<string>
      | Summary<string>
      | undefined

    if (type === 'counter') {
      instance = new Counter({ name, help })
    } else if (type === 'gauge') {
      instance = new Gauge({ name, help })
    } else if (type === 'histogram') {
      instance = new Histogram({ name, help })
    } else if (type === 'summary') {
      instance = new Summary({ name, help })
    }

    if (instance) {
      registry.registerMetric(instance)
      instances[name] = { type, instance }
    }
  }

  const add = ({ name, data }: AddMetricData): void => {
    const metric = instances[name]
    if (metric) {
      const { type, instance } = metric

      if (type === 'counter') {
        (instance as Counter<string>).inc(data)
      } else if (type === 'gauge') {
        (instance as Gauge<string>).set(data)
      } else if (type === 'histogram') {
        (instance as Histogram<string>).observe(data)
      } else if (type === 'summary') {
        (instance as Summary<string>).observe(data)
      }
    }
  }

  const get = async () => {
    return {
      metrics: await registry.metrics(),
      contentType: register.contentType
    }
  }

  return { create, add, get }
}

const Prometheus = prometheus()

// Create metrics

Prometheus.create({
  type: 'gauge',
  name: MetricName.L1MonitorHeight,
  help: '[Executor] Current height of the L1 monitor.'
})

Prometheus.create({
  type: 'gauge',
  name: MetricName.L2MonitorHeight,
  help: '[Executor] Current height of the L2 monitor.'
})

Prometheus.create({
  type: 'gauge',
  name: MetricName.L1MonitorTime,
  help: '[Executor] Time taken to process L1 monitor.'
})

Prometheus.create({
  type: 'gauge',
  name: MetricName.L2MonitorTime,
  help: '[Executor] Time taken to process L2 monitor.'
})

export { Prometheus }
