const config = require('./config');
const os = require('os');
const requests = {};
const requestsByMethod = {};
const activeUsers = {};
const authAttempts = {
    success: 0,
    failure: 0
};
const pizzaMetrics = {
    success: 0,
    failure: 0,
    revenue: 0,
    pizzaCount: 0,
    latency: 0
};

function getCpuUsagePercentage() {
    const cpuUsage = os.loadavg()[0] / os.cpus().length;
    return cpuUsage.toFixed(2) * 100;
}

function getMemoryUsagePercentage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    const memoryUsage = (usedMemory / totalMemory) * 100;
    return memoryUsage.toFixed(2);
}

function requestTracker(req, res, next) {
    const endpoint = `[${req.method}] ${req.path}`;

    if (req.method === 'OPTIONS') {
        return next(); // skip counting OPTIONS requests
    }

    // total requests per endpoint
    requests[endpoint] = (requests[endpoint] || 0) + 1;

    // requests by HTTP method
    requestsByMethod[req.method] = (requestsByMethod[req.method] || 0) + 1;

    //active users
    trackActiveUser(req);

    next();
}

function trackActiveUser(req) {
    if (!req.user) return;

    activeUsers[req.user.id] = Date.now();
}

function getActiveUserCount() {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    return Object.values(activeUsers)
        .filter(lastSeen => now - lastSeen < fiveMinutes)
        .length;
}

function authAttempt(success) {
    if (success) {
        authAttempts.success += 1;
    } else {
        authAttempts.failure += 1;
    }
}

function pizzaPurchase(success, latency = 0, price = 0, count = 0) {
    if (success) {
        pizzaMetrics.success += 1;
        pizzaMetrics.revenue += price;
        pizzaMetrics.pizzaCount += count;
        pizzaMetrics.latency += latency;
    } else {
        pizzaMetrics.failure += 1;
        pizzaMetrics.latency += latency;
    }
}

// This will periodically send metrics to Grafana
function sendMetrics() {
    setInterval(() => {
        const metrics = [];
        Object.keys(requests).forEach((endpoint) => {
            metrics.push(createMetric('requests', requests[endpoint], '1', 'sum', 'asInt', {endpoint}));
        });

        // total requests per HTTP method
        Object.keys(requestsByMethod).forEach((method) => {
            metrics.push(createMetric('requestsByMethod', requestsByMethod[method], '1', 'sum', 'asInt', {method}));
        });

        //active users
        metrics.push(createMetric('activeUsers', getActiveUserCount(), '1', 'gauge', 'asInt', {}));

        //CPU and Memory
        metrics.push(createMetric('cpuUsage', getCpuUsagePercentage(), '%', 'gauge', 'asDouble', {}));
        metrics.push(createMetric('memoryUsage', getMemoryUsagePercentage(), '%', 'gauge', 'asDouble', {}));

        // authentication attempts
        metrics.push(createMetric('authAttempts', authAttempts.success, '1', 'sum', 'asInt', {result: 'success'}));
        metrics.push(createMetric('authAttempts', authAttempts.failure, '1', 'sum', 'asInt', {result: 'failure'}));


        // pizza purchase metrics
        metrics.push(createMetric('pizzaPurchases', pizzaMetrics.success, '1', 'sum', 'asInt', {result: 'success'}));
        metrics.push(createMetric('pizzaPurchases', pizzaMetrics.failure, '1', 'sum', 'asInt', {result: 'failure'}));

        metrics.push(createMetric('pizzaRevenue', pizzaMetrics.revenue, 'BTC', 'sum', 'asDouble', {}));

        metrics.push(createMetric('pizzaCount', pizzaMetrics.pizzaCount, '1', 'sum', 'asInt', {}));

        if (pizzaMetrics.success > 0) {
            metrics.push(createMetric('pizzaLatency', pizzaMetrics.latency, 'ms', 'gauge', 'asDouble', {}));
        }

        console.log(JSON.stringify(metrics, null, 2));
        sendMetricToGrafana(metrics);
    }, 10000);
}

function createMetric(metricName, metricValue, metricUnit, metricType, valueType, attributes) {
    attributes = {...attributes, source: config.metrics.source};

    const metric = {
        name: metricName,
        unit: metricUnit,
        [metricType]: {
            dataPoints: [
                {
                    [valueType]: metricValue,
                    timeUnixNano: Date.now() * 1000000,
                    attributes: [],
                },
            ],
        },
    };

    Object.keys(attributes).forEach((key) => {
        metric[metricType].dataPoints[0].attributes.push({
            key: key,
            value: {stringValue: attributes[key]},
        });
    });

    if (metricType === 'sum') {
        metric[metricType].aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
        metric[metricType].isMonotonic = true;
    }

    return metric;
}

function sendMetricToGrafana(metrics) {
    const body = {
        resourceMetrics: [
            {
                scopeMetrics: [
                    {
                        metrics,
                    },
                ],
            },
        ],
    };

    fetch(`${config.metrics.endpointUrl}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json'},
    })
        .then((response) => {
            if (!response.ok) {
                throw new Error(`HTTP status: ${response.status}`);
            }
        })
        .catch((error) => {
            console.error('Error pushing metrics:', error);
        });
}

module.exports = {requestTracker, authAttempt, pizzaPurchase, sendMetrics};