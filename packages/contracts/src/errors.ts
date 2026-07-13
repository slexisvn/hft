export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvariantError';
  }
}

export class OrderStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderStateError';
  }
}

export class SequenceGapError extends Error {
  readonly expected: number;
  readonly received: number;
  constructor(expected: number, received: number) {
    super(`sequence gap: expected ${expected}, received ${received}`);
    this.name = 'SequenceGapError';
    this.expected = expected;
    this.received = received;
  }
}

export class KillSwitchError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`kill switch tripped: ${reason}`);
    this.name = 'KillSwitchError';
    this.reason = reason;
  }
}

export class PromotionGateError extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(`model failed promotion gate: ${reasons.join('; ')}`);
    this.name = 'PromotionGateError';
    this.reasons = reasons;
  }
}
