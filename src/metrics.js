const config = require('./config');
const os = require('os');
const requests = {};
const requestsByMethod = {};
const activeUsers = {};

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
    console.log("REQ USER:", req.user);
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

// This will periodically send metrics to Grafana
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

    console.log(JSON.stringify(metrics, null, 2));
    sendMetricToGrafana(metrics);
}, 10000);

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

module.exports = {requestTracker};