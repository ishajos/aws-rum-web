import { FetchPlugin } from '../FetchPlugin';
import {
    HttpPluginConfig,
    X_AMZN_TRACE_ID,
    W3C_TRACEPARENT_HEADER_NAME
} from '../../utils/http-utils';
import { advanceTo } from 'jest-date-mock';
import {
    getSession,
    record,
    xRayOffContext,
    xRayOnContext,
    w3cTraceIdOnContext,
    mockFetch,
    mockFetchWith500,
    mockFetchWithError,
    mockFetchWithErrorObject,
    mockFetchWithErrorObjectAndStack,
    mockFetchWith400,
    mockFetchWith429
} from '../../../test-utils/test-utils';
import { GetSession, PluginContext } from '../../types';
import { XRAY_TRACE_EVENT_TYPE, HTTP_EVENT_TYPE } from '../../utils/constant';
import { HttpEvent } from '../../../events/http-event';

// Mock getRandomValues -- since it does nothing, the 'random' number will be 0.
jest.mock('../../../utils/random');

const URL = 'https://aws.amazon.com';

const TRACE_ID =
    'Root=1-0-000000000000000000000000;Parent=0000000000000000;Sampled=1';

const W3C_TRACE_ID = '00-00000000000000000000000000000000-0000000000000000-01';

const existingTraceId = '1-0-000000000000000000000001';
const existingSegmentId = '0000000000000001';
const existingTraceHeaderValue = `Root=${existingTraceId};Parent=${existingSegmentId};Sampled=1`;

const existingW3CTraceId = '00000000000000000000000000000001';
const existingW3CTraceHeaderValue = `00-${existingW3CTraceId}-${existingSegmentId}-01`;

const Headers = function (init?: Record<string, string>) {
    const headers = init ? init : {};
    this.get = (name: string) => {
        return headers[name];
    };
    this.set = (name: string, value: string) => {
        headers[name] = value;
    };
};

const Request = function (input: RequestInfo, init?: RequestInit) {
    if (typeof input === 'string') {
        this.url = input;
        this.method = 'GET';
        this.headers = new Headers();
    } else {
        this.url = input.url;
        this.method = input.method ? input.method : 'GET';
        this.headers = input.headers ? input.headers : new Headers();
    }
    if (init) {
        this.method = init.method ? init.method : this.method;
        if (
            this.headers &&
            typeof (init.headers as Headers).get === 'function'
        ) {
            this.headers = init.headers;
        } else if (this.headers) {
            this.headers = new Headers(init.headers as Record<string, string>);
        }
    }
};
global.fetch = mockFetch;

describe('FetchPlugin tests', () => {
    beforeEach(() => {
        advanceTo(0);
        mockFetch.mockClear();
        mockFetchWith500.mockClear();
        mockFetchWithError.mockClear();
        mockFetchWithErrorObject.mockClear();
        mockFetchWithErrorObjectAndStack.mockClear();
        record.mockClear();
        getSession.mockClear();
    });

    test('when fetch is called then the plugin records the http request/response', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'GET',
                url: URL
            },
            response: {
                status: 200,
                statusText: 'OK'
            }
        });
    });

    test('when fetch is called with a Request/RequestInfo then the plugin records the http request/response', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        const request: RequestInfo = {
            url: URL,
            method: 'POST'
        } as RequestInfo;

        // Run
        await fetch(request);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'POST',
                url: URL
            },
            response: {
                status: 200,
                statusText: 'OK'
            }
        });
    });

    test('when fetch throws an error then the plugin adds the error to the http event', async () => {
        // Init
        global.fetch = mockFetchWithError;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL).catch((error) => {
            // Expected
        });
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWithError).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'GET',
                url: URL
            },
            error: {
                version: '1.0.0',
                type: 'Timeout'
            }
        });
    });

    test('when fetch throws an error object then the plugin adds the error object to the http event', async () => {
        // Init
        global.fetch = mockFetchWithErrorObject;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL).catch((error) => {
            // Expected
        });
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWithErrorObject).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'GET',
                url: URL
            },
            error: {
                version: '1.0.0',
                type: 'Error',
                message: 'Timeout',
                stack: expect.stringContaining('test-utils.ts')
            }
        });
    });

    test('when fetch is called with w3c format disabled then the plugin records a trace with xray trace id format', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
        const tmp = record.mock.calls[0][1];
        expect(record.mock.calls[0][1]).toMatchObject({
            name: 'sample.rum.aws.amazon.com',
            id: '0000000000000000',
            start_time: 0,
            trace_id: '1-0-000000000000000000000000',
            end_time: 0,
            subsegments: [
                {
                    id: '0000000000000000',
                    name: 'aws.amazon.com',
                    start_time: 0,
                    end_time: 0,
                    namespace: 'remote',
                    http: {
                        request: {
                            method: 'GET',
                            url: URL,
                            traced: true
                        },
                        response: { status: 200, content_length: 125 }
                    }
                }
            ]
        });
    });

    test('when fetch is called with w3c format enabled then the plugin records a trace with w3c trace id format', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
        const tmp = record.mock.calls[0][1];
        expect(record.mock.calls[0][1]).toMatchObject({
            name: 'sample.rum.aws.amazon.com',
            id: '0000000000000000',
            start_time: 0,
            trace_id: '00000000000000000000000000000000',
            end_time: 0,
            subsegments: [
                {
                    id: '0000000000000000',
                    name: 'aws.amazon.com',
                    start_time: 0,
                    end_time: 0,
                    namespace: 'remote',
                    http: {
                        request: {
                            method: 'GET',
                            url: URL,
                            traced: true
                        },
                        response: { status: 200, content_length: 125 }
                    }
                }
            ]
        });
    });

    test('when fetch throws an error then the plugin adds the error to the trace with w3c format disabled', async () => {
        // Init
        global.fetch = mockFetchWithError;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL).catch((error) => {
            // Expected
        });
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWithError).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            name: 'sample.rum.aws.amazon.com',
            id: '0000000000000000',
            start_time: 0,
            trace_id: '1-0-000000000000000000000000',
            end_time: 0,
            fault: true,
            subsegments: [
                {
                    id: '0000000000000000',
                    name: 'aws.amazon.com',
                    start_time: 0,
                    end_time: 0,
                    http: {
                        request: {
                            method: 'GET',
                            url: URL,
                            traced: true
                        }
                    },
                    fault: true,
                    cause: {
                        exceptions: [
                            {
                                type: 'Timeout'
                            }
                        ]
                    }
                }
            ]
        });
    });

    test('when fetch throws an error then the plugin adds the error to the trace with w3c format enabled', async () => {
        // Init
        global.fetch = mockFetchWithError;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        // Run
        await fetch(URL).catch((error) => {
            // Expected
        });
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWithError).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            name: 'sample.rum.aws.amazon.com',
            id: '0000000000000000',
            start_time: 0,
            trace_id: '00000000000000000000000000000000',
            end_time: 0,
            fault: true,
            subsegments: [
                {
                    id: '0000000000000000',
                    name: 'aws.amazon.com',
                    start_time: 0,
                    end_time: 0,
                    http: {
                        request: {
                            method: 'GET',
                            url: URL,
                            traced: true
                        }
                    },
                    fault: true,
                    cause: {
                        exceptions: [
                            {
                                type: 'Timeout'
                            }
                        ]
                    }
                }
            ]
        });
    });

    test('when fetch returns a 404 then segment error is true', async () => {
        // Init
        global.fetch = mockFetchWith400;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(record.mock.calls[0][1]).toMatchObject({
            error: true,
            subsegments: [
                {
                    error: true,
                    http: {
                        response: { status: 404 }
                    }
                }
            ]
        });
    });

    test('when fetch returns a 429 then segment throttle is true', async () => {
        // Init
        global.fetch = mockFetchWith429;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(record.mock.calls[0][1]).toMatchObject({
            throttle: true,
            subsegments: [
                {
                    throttle: true,
                    http: {
                        response: { status: 429 }
                    }
                }
            ]
        });
    });

    test('when fetch returns a 500 then segment fault is true', async () => {
        // Init
        global.fetch = mockFetchWith500;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(record.mock.calls[0][1]).toMatchObject({
            fault: true,
            subsegments: [
                {
                    fault: true,
                    http: {
                        response: { status: 500 }
                    }
                }
            ]
        });
    });

    test('when plugin is disabled then the plugin does not record a trace', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);
        plugin.disable();

        // Run
        await fetch(URL);

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
    });

    test('when plugin is re-enabled then the plugin records a trace', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);
        plugin.disable();
        plugin.enable();

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
    });

    test('when default config is used then X-Amzn-Trace-Id header is not added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {};

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toEqual(undefined);
    });

    test('when addXRayTraceIdHeader is true and w3c format disabled then X-Amzn-Trace-Id header is added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls[0][1]).toMatchObject({
            headers: {
                [X_AMZN_TRACE_ID]: TRACE_ID
            }
        });
    });

    test('when addXRayTraceIdHeader is true and w3c format enabled then traceparent header is added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls[0][1]).toMatchObject({
            headers: {
                [W3C_TRACEPARENT_HEADER_NAME]: W3C_TRACE_ID
            }
        });
    });

    test('when addXRayTraceIdHeader is false then X-Amzn-Trace-Id header is not added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: false
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toEqual(undefined);
    });

    test('when url matches some regex in addXRayTraceIdHeader and w3c format disabled then X-Amzn-Trace-Id header is added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: [/noMatch/, new RegExp(URL)]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        const init: RequestInit = {};

        // Run
        await fetch(URL, init);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls[0][1]).toMatchObject({
            headers: {
                [X_AMZN_TRACE_ID]: TRACE_ID
            }
        });
    });

    test('when url matches some regex in addXRayTraceIdHeader and w3c format enabled then traceparent header is added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: [/noMatch/, new RegExp(URL)]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        const init: RequestInit = {};

        // Run
        await fetch(URL, init);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls[0][1]).toMatchObject({
            headers: {
                [W3C_TRACEPARENT_HEADER_NAME]: W3C_TRACE_ID
            }
        });
    });

    test('when url matches no regex in addXRayTraceIdHeader with w3c format enabled then X-Amzn-Trace-Id header is not added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: [/noMatch/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toEqual(undefined);
    });

    test('when url matches no regex in addXRayTraceIdHeader with w3c format disabled then traceparent header is not added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: [/noMatch/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toEqual(undefined);
    });

    test('when addXRayTraceIdHeader is an empty array with w3c format disabled then X-Amzn-Trace-Id header is not added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: []
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toEqual(undefined);
    });

    test('when addXRayTraceIdHeader is an empty array with w3c format enabled then traceparent header is not added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: []
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toEqual(undefined);
    });

    test('when init object is provided with w3c trace disabled then X-Amzn-Trace-Id header is added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        const init: RequestInit = {
            method: 'POST',
            headers: {
                x: 'y'
            }
        };

        // Run
        await fetch(URL, Object.assign({}, init));
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toMatchObject({
            headers: {
                [X_AMZN_TRACE_ID]: TRACE_ID
            }
        });
    });

    test('when init object is provided with w3c trace enabled then traceparent header is added to the HTTP request', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        const init: RequestInit = {
            method: 'POST',
            headers: {
                x: 'y'
            }
        };

        // Run
        await fetch(URL, Object.assign({}, init));
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toMatchObject({
            headers: {
                [W3C_TRACEPARENT_HEADER_NAME]: W3C_TRACE_ID
            }
        });
    });

    test('when init object is provided then request options are persisted after adding trace id header', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        const init: RequestInit = {
            method: 'POST',
            headers: {
                x: 'y'
            }
        };

        // Run
        await fetch(URL, JSON.parse(JSON.stringify(init)));
        plugin.disable();

        // Assert
        expect(mockFetch.mock.calls.length).toEqual(1);
        expect(mockFetch.mock.calls[0][1]).toMatchObject(init);
    });

    test('when trace is disabled then the plugin does not record a trace', async () => {
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
    });

    test('when session is not being recorded then the plugin does not record a trace', async () => {
        const getSession: jest.MockedFunction<GetSession> = jest.fn(() => ({
            sessionId: 'abc123',
            record: false,
            eventCount: 0
        }));
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };
        const context = Object.assign({}, xRayOnContext, { getSession });
        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(context);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
    });

    test('when getSession returns undefined then the plugin does not record a trace', async () => {
        const getSession: jest.MockedFunction<GetSession> = jest.fn(
            () => undefined
        );
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };
        const context = Object.assign({}, xRayOnContext, { getSession });

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(context);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
    });

    test('the plugin records a stack trace by default', async () => {
        // Init
        global.fetch = mockFetchWithErrorObjectAndStack;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL).catch((error) => {
            // Expected
        });
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWithErrorObjectAndStack).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'GET'
            },
            error: {
                version: '1.0.0',
                type: 'FetchError',
                message: 'timeout',
                stack: 'stack trace'
            }
        });
    });

    test('when stack trace length is zero then the plugin does not record a stack trace', async () => {
        // Init
        global.fetch = mockFetchWithErrorObjectAndStack;
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/],
            stackTraceLength: 0
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL).catch((error) => {
            // Expected
        });
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWithErrorObjectAndStack).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'GET'
            },
            error: {
                version: '1.0.0',
                type: 'FetchError',
                message: 'timeout'
            }
        });
        expect((record.mock.calls[0][1] as HttpEvent).error.stack).toEqual(
            undefined
        );
    });

    test('when recordAllRequests is true then the plugin records a request with status OK', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
    });

    test('when recordAllRequests is false then the plugin does not record a request with status OK', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: false
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(0);
    });

    test('when recordAllRequests is false then the plugin records a request with status 500', async () => {
        // Init
        global.fetch = mockFetchWith500;
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: false
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();
        global.fetch = mockFetch;

        // Assert
        expect(mockFetchWith500).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
    });

    test('when a url is excluded then the plugin does not record a request to that url', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            urlsToExclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
    });

    test('when a Request url is excluded then the plugin does not record a request to that url', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/.*/],
            urlsToExclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch({ url: URL } as Request);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).not.toHaveBeenCalled();
    });

    test('all urls are included by default', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalled();
    });

    test('when a request is made to cognito or sts using default exclude list then the requests are not recorded', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch('https://cognito-identity.us-west-2.amazonaws.com');
        await fetch('https://sts.us-west-2.amazonaws.com');
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(record).not.toHaveBeenCalled();
    });

    test('when a request is made to cognito or sts using an empty exclude list then the requests are recorded', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            recordAllRequests: true,
            urlsToExclude: []
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch('https://cognito-identity.us-west-2.amazonaws.com');
        await fetch('https://sts.us-west-2.amazonaws.com');
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('when a url is relative then the subsegment name is location.hostname', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {};
        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch('/resource');
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            subsegments: [
                {
                    name: 'us-east-1.console.aws.amazon.com'
                }
            ]
        });
    });

    test('when fetch uses request object with w3c format disabled then trace headers are added to the request object', async () => {
        // Init
        const SIGN_HEADER_KEY = 'x-amzn-security-token';
        const SIGN_HEADER_VAL = 'abc123';

        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true,
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        const init: RequestInit = {
            headers: {
                [SIGN_HEADER_KEY]: SIGN_HEADER_VAL
            }
        };

        const request: Request = new Request(URL, init);

        // Run
        await fetch(request);
        plugin.disable();

        // Assert
        expect(request.headers.get(X_AMZN_TRACE_ID)).toEqual(TRACE_ID);
        expect(request.headers.get(SIGN_HEADER_KEY)).toEqual(SIGN_HEADER_VAL);
    });

    test('when fetch uses request object with w3c format enabled then trace headers are added to the request object', async () => {
        // Init
        const SIGN_HEADER_KEY = 'x-amzn-security-token';
        const SIGN_HEADER_VAL = 'abc123';

        const config: Partial<HttpPluginConfig> = {
            addXRayTraceIdHeader: true,
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        const init: RequestInit = {
            headers: {
                [SIGN_HEADER_KEY]: SIGN_HEADER_VAL
            }
        };

        const request: Request = new Request(URL, init);

        // Run
        await fetch(request);
        plugin.disable();

        // Assert
        expect(request.headers.get(W3C_TRACEPARENT_HEADER_NAME)).toEqual(
            W3C_TRACE_ID
        );
        expect(request.headers.get(SIGN_HEADER_KEY)).toEqual(SIGN_HEADER_VAL);
    });

    test('when fetch uses request object then the URL is added to the event', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        const request: Request = new Request(URL);

        // Run
        await fetch(request);
        plugin.disable();

        // Assert
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            request: {
                method: 'GET',
                url: URL
            },
            response: {
                status: 200,
                statusText: 'OK'
            }
        });
    });

    test('when tracing is enabled and w3c format disabled then the trace id is added to the http event', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(2);
        expect(record.mock.calls[1][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[1][1]).toMatchObject({
            trace_id: '1-0-000000000000000000000000',
            segment_id: '0000000000000000'
        });
    });

    test('when tracing is enabled and w3c format enabled then the trace id is added to the http event', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(2);
        expect(record.mock.calls[1][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[1][1]).toMatchObject({
            trace_id: '00000000000000000000000000000000',
            segment_id: '0000000000000000'
        });
    });

    test('when tracing is not enabled then the trace id is not added to the http event', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOffContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).not.toMatchObject({
            trace_id: expect.anything()
        });
        expect(record.mock.calls[0][1]).not.toMatchObject({
            segment_id: expect.anything()
        });
    });
    test('when fetch is called and request has existing trace header with xray trace format then existing trace data is added to the http event', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        const init: RequestInit = {
            headers: {
                [X_AMZN_TRACE_ID]: existingTraceHeaderValue
            }
        };

        const request: Request = new Request(URL, init);

        // Run
        await fetch(request);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            trace_id: existingTraceId,
            segment_id: existingSegmentId
        });
    });

    test('when fetch is called and request has existing trace header with w3c format then existing trace data is added to the http event and segment id is updated', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            logicalServiceName: 'sample.rum.aws.amazon.com',
            urlsToInclude: [/aws\.amazon\.com/],
            recordAllRequests: true
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(w3cTraceIdOnContext);

        const init: RequestInit = {
            headers: {
                [W3C_TRACEPARENT_HEADER_NAME]: existingW3CTraceHeaderValue
            }
        };

        const request: Request = new Request(URL, init);

        // Run
        await fetch(request);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(HTTP_EVENT_TYPE);
        expect(record.mock.calls[0][1]).toMatchObject({
            trace_id: existingW3CTraceId
        });
        expect(record.mock.calls[0][1]).toMatchObject({
            segment_id: existingSegmentId
        });
    });

    test('when the url does not match urlsToInclude then the plugin does not record a trace', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            recordAllRequests: true,
            urlsToInclude: [/a^/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(0);
    });

    test('when the url matches urlsToInclude then the plugin records a trace', async () => {
        // Init
        const config: Partial<HttpPluginConfig> = {
            urlsToInclude: [/https:\/\/aws\.amazon\.com/]
        };

        const plugin: FetchPlugin = new FetchPlugin(config);
        plugin.load(xRayOnContext);

        // Run
        await fetch(URL);
        plugin.disable();

        // Assert
        expect(record).toHaveBeenCalledTimes(1);
        expect(record.mock.calls[0][0]).toEqual(XRAY_TRACE_EVENT_TYPE);
    });
});
