export type AwsState =
    | 'checking'
    | 'active'
    | 'expired'
    | 'signed-out'
    | 'missing-cli'
    | 'unconfigured'
    | 'unavailable';
export interface AwsStatus {
    state: AwsState;
}
export type LoginAction = 'aws' | 'registry';
export type LoginResult = import('./runtime-strategy.js').OperationResult;
