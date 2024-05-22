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
  CPU_USAGE_GAUGE = 'cpu_usage_gauge',
  MEMORY_USAGE_GAUGE = 'memory_usage_gauge',
  LATENCY_GAUGE = 'latency_gauge',
  REQUEST_LATENCY_HISTOGRAM = 'request_latency_histogram',
  REQUEST_COUNT = 'request_count',
  REQUEST_STATUS_CODE_COUNTER = 'status_code_counter'
}

interface CreateMetricOptions {
  type: MetricType;
  name: string;
  help: string;
  buckets?: number[];
}

interface AddMetricData {
  name: string;
  data: number;
  labels?: Partial<Record<string, string>>;
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

  const create = ({ type, name, help, buckets }: CreateMetricOptions): void => {
    let instance:
      | Counter<string>
      | Gauge<string>
      | Histogram<string>
      | Summary<string>
      | undefined

    if (type === 'counter') {
      instance = new Counter({ name, help, labelNames: ['status_code'] })
    } else if (type === 'gauge') {
      instance = new Gauge({ name, help })
    } else if (type === 'histogram') {
      instance = new Histogram({ name, help, buckets })
    } else if (type === 'summary') {
      instance = new Summary({ name, help })
    }

    if (instance) {
      registry.registerMetric(instance)
      instances[name] = { type, instance }
    }
  }

  const add = ({ name, data, labels }: AddMetricData): void => {
    const metric = instances[name]
    if (metric) {
      const { type, instance } = metric

      if (type === 'counter') {
        if (labels) {
          (instance as Counter<string>).inc(labels, data)
        } else {
          (instance as Counter<string>).inc(data)
        }
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

  const startLatencyTimer = (name: string) => {
    const metricName = `${name}_latency_histogram`
    if (!instances[metricName]) {
      create({
        type: 'histogram',
        name: metricName,
        help: `Latency of the ${name} function in milliseconds.`,
        buckets: [0.1, 5, 15, 50, 100, 500, 1000]
      })
    }
    return (instances[metricName].instance as Histogram<string>).startTimer()
  }

  const startStatusCodeCounter = (name: string) => {
    const metricName = `${name}_${MetricName.REQUEST_STATUS_CODE_COUNTER}`
    if (!instances[metricName]) {
      create({
        type: 'counter',
        name: metricName,
        help: `Count of the ${name} function by status code.`
      })
    }
    return instances[metricName].instance as Counter<string>
  }

  return { create, add, get, startLatencyTimer, startStatusCodeCounter }
}

const Prometheus = prometheus()

// Create metrics

Prometheus.create({
  type: 'gauge',
  name: MetricName.CPU_USAGE_GAUGE,
  help: 'CPU usage of the process.'
})

Prometheus.create({
  type: 'gauge',
  name: MetricName.MEMORY_USAGE_GAUGE,
  help: 'Memory usage of the process.'
})

export const updateUsageMetrics = () => {
  const memoryUsage = process.memoryUsage()
  const cpuUsage = process.cpuUsage()

  const memoryUsageInMB = memoryUsage.rss / 1024 / 1024
  const cpuUsageInSec = (cpuUsage.user + cpuUsage.system) / 1000000

  Prometheus.add({
    name: MetricName.MEMORY_USAGE_GAUGE,
    data: memoryUsageInMB
  })

  Prometheus.add({
    name: MetricName.CPU_USAGE_GAUGE,
    data: cpuUsageInSec
  })
}

export { Prometheus }
