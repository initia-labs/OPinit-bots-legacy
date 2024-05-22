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
  OPINIT_BOT = 'opinit_bot',
  REQUEST_LATENCY_HISTOGRAM = 'request_latency_histogram',
  REQUEST_STATUS_CODE_COUNTER = 'request_status_code_counter',
  EXECUTOR_CPU_USAGE_GAUGE = 'opinit_bot_executor_cpu_usage_gauge',
  EXECUTOR_MEMORY_USAGE_GAUGE = 'opinit_bot_executor_memory_usage_gauge',
  OUTPUT_CPU_USAGE_GAUGE = 'opinit_bot_output_cpu_usage_gauge',
  OUTPUT_MEMORY_USAGE_GAUGE = 'opinit_bot_output_memory_usage_gauge',
  BATCH_CPU_USAGE_GAUGE = 'opinit_bot_batch_cpu_usage_gauge',
  BATCH_MEMORY_USAGE_GAUGE = 'opinit_bot_batch_memory_usage_gauge'
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
    const metricName = `${MetricName.OPINIT_BOT}_${name}_${MetricName.REQUEST_LATENCY_HISTOGRAM}`
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

const metricsToCreate: CreateMetricOptions[] = [
  {
    type: 'gauge',
    name: MetricName.EXECUTOR_CPU_USAGE_GAUGE,
    help: 'CPU usage of the process.'
  },
  {
    type: 'gauge',
    name: MetricName.EXECUTOR_MEMORY_USAGE_GAUGE,
    help: 'Memory usage of the process.'
  },
  {
    type: 'gauge',
    name: MetricName.OUTPUT_CPU_USAGE_GAUGE,
    help: 'CPU usage of the process.'
  },
  {
    type: 'gauge',
    name: MetricName.OUTPUT_MEMORY_USAGE_GAUGE,
    help: 'Memory usage of the process.'
  },
  {
    type: 'gauge',
    name: MetricName.BATCH_CPU_USAGE_GAUGE,
    help: 'CPU usage of the process.'
  },
  {
    type: 'gauge',
    name: MetricName.BATCH_MEMORY_USAGE_GAUGE,
    help: 'Memory usage of the process.'
  }
]

// Create the metrics
metricsToCreate.forEach((metric) => Prometheus.create(metric))

const updateUsageMetrics = (
  cpuMetric: MetricName,
  memoryMetric: MetricName
) => {
  const memoryUsage = process.memoryUsage()
  const cpuUsage = process.cpuUsage()

  const memoryUsageInMB = memoryUsage.rss / 1024 / 1024
  const cpuUsageInSec = (cpuUsage.user + cpuUsage.system) / 1000000

  Prometheus.add({
    name: memoryMetric,
    data: memoryUsageInMB
  })

  Prometheus.add({
    name: cpuMetric,
    data: cpuUsageInSec
  })
}

export const updateExecutorUsageMetrics = () =>
  updateUsageMetrics(
    MetricName.EXECUTOR_CPU_USAGE_GAUGE,
    MetricName.EXECUTOR_MEMORY_USAGE_GAUGE
  )

export const updateOutputUsageMetrics = () =>
  updateUsageMetrics(
    MetricName.OUTPUT_CPU_USAGE_GAUGE,
    MetricName.OUTPUT_MEMORY_USAGE_GAUGE
  )

export const updateBatchUsageMetrics = () =>
  updateUsageMetrics(
    MetricName.BATCH_CPU_USAGE_GAUGE,
    MetricName.BATCH_MEMORY_USAGE_GAUGE
  )

export { Prometheus }
