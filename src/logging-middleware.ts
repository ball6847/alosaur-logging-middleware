import { DateTime, type HttpContext, type MiddlewareTarget } from '../deps.ts';
import { getClientIp } from './request-ip.ts';

export enum LoggingFormat {
  COMMON,
  APACHE_COMBINED,
}

// export enum ResolutionField {
//   rfc931,
//   authuser,
//   bytes,
// }

// export type resolver = (ctx: HttpContext) => string | Promise<string>;

export type logger = (message: string) => string;

export type LoggingOpts = {
  format?: LoggingFormat;
  utcTime?: boolean;
  includeDuration?: boolean;
  // resolvers?: {
  //   [ResolutionField.rfc931]?: resolver;
  //   [ResolutionField.authuser]?: resolver;
  //   [ResolutionField.bytes]?: resolver;
  // };
  logger?: logger;
  combinedHeaders?: string[];
};

type LoggingState = {
  logging: {
    start: number;
  };
};

const headerResolver = (context: HttpContext, header: string) =>
  context.request.headers.has(header) ? `"${context.request.headers.get(header)}"` : '-';

export class LoggingMiddleware implements MiddlewareTarget<LoggingState> {
  constructor(private options: LoggingOpts = {}) {}

  onPreRequest(context: HttpContext<LoggingState>): void {
    const start = performance.now();

    if (!context.state?.logging) {
      context.state = {
        ...context.state,
        logging: { start },
      };
    } else {
      context.state.logging = { start };
    }
  }

  onPostRequest(context: HttpContext<LoggingState>): void {
    const combinedHeaders = this.options?.combinedHeaders ?? ['Referer', 'User-agent'];
    const logger = this.options?.logger ?? console.info;
    const duration = this.getDuration(context);

    // defer execution to the end of event loop, so we can get the response status
    // note that duration cannot be defer, because response won't be available for modification after request is done
    setTimeout(() => {
      const parts = this.getCommonLogParts(context);

      // apache combined need more context on headers
      if (this.options?.format === LoggingFormat.APACHE_COMBINED) {
        parts.push(
          ...combinedHeaders
            .slice(0, 2)
            .map((header) => headerResolver(context, header)),
        );
      }

      // add duration
      parts.push(`${duration}ms`);

      // log everything in one line
      logger(parts.join(' '));
    });
  }

  getDuration(context: HttpContext<LoggingState>) {
    const duration = (performance.now() - (context.state as LoggingState).logging.start).toFixed(1);
    if (this.options?.includeDuration) {
      context.response.headers.set('x-response-time', duration);
    }
    return duration;
  }

  getTimestamp() {
    const now = this.options?.utcTime ? DateTime.utc() : DateTime.now();
    return `[${now.toFormat('dd/MMM/yyyy:HH:mm:ss ZZZ')}]`;
  }

  getIp(context: HttpContext<LoggingState>) {
    return getClientIp(context.request.serverRequest.request) ?? '-';
  }

  getStatusCode(context: HttpContext<LoggingState>): string {
    if (context.response.result.status) {
      return context.response.result.status.toString();
    }
    if (context.response.status) {
      return context.response.status.toString();
    }
    return '-';
  }

  getCommonLogParts(context: HttpContext<LoggingState>) {
    return [
      this.getIp(context),
      this.getTimestamp(),
      context.request.method,
      context.request.url,
      this.getStatusCode(context),
    ];
  }
}
