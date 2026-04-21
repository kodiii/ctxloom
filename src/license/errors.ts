export class LicenseRequiredError extends Error {
  readonly code = 'license_required';
  constructor(message = 'ctxloom requires an active license.') {
    super(message);
    this.name = 'LicenseRequiredError';
  }
}

export class SeatLimitError extends Error {
  readonly code = 'seat_limit_exceeded';
  constructor(message = 'Seat limit reached.') {
    super(message);
    this.name = 'SeatLimitError';
  }
}

export class InvalidKeyError extends Error {
  readonly code = 'invalid_key';
  constructor(message = 'Invalid license key.') {
    super(message);
    this.name = 'InvalidKeyError';
  }
}

export class LicenseRevokedError extends Error {
  readonly code = 'license_revoked';
  constructor(message = 'License has been revoked.') {
    super(message);
    this.name = 'LicenseRevokedError';
  }
}

export class NetworkError extends Error {
  readonly code = 'network_error';
  constructor(message = 'Network request failed.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class FingerprintAlreadyUsedError extends Error {
  readonly code = 'fingerprint_already_used';
  constructor() {
    super('A trial has already been used on this machine.');
    this.name = 'FingerprintAlreadyUsedError';
  }
}

export class EmailAlreadyUsedError extends Error {
  readonly code = 'email_already_used';
  constructor() {
    super('A trial has already been used for this email address.');
    this.name = 'EmailAlreadyUsedError';
  }
}
