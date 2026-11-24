/** HTTP adapter for caller-managed authentication, quota and hosting. No server is started. */
export interface InspectorHttpOptions {
  authorize: (request: Request) => boolean | Promise<boolean>;
  consumeQuota: (request: Request) => boolean | Promise<boolean>;
  maxBytes?: number;
}
export declare function createInspectorHttpHandler(options: InspectorHttpOptions): (request: Request) => Promise<Response>;
