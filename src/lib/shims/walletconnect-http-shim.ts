export class HttpConnection {
  url: string;
  constructor(url?: string) {
    this.url = url || "";
  }
  formatUrl() {
    return this.url;
  }
  send() {
    return Promise.reject(new Error("WalletConnect is disabled on Stellar"));
  }
  open() {
    return Promise.resolve();
  }
  close() {
    return Promise.resolve();
  }
  on() {
    return this;
  }
  once() {
    return this;
  }
  off() {
    return this;
  }
  removeListener() {
    return this;
  }
}

export default HttpConnection;
