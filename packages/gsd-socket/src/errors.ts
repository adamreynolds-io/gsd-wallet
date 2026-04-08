export class SessionEndedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Socket session ended: ${reason}`);
    this.reason = reason;
    this.name = 'SessionEndedError';
  }
}
