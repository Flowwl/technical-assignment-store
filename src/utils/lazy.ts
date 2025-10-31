export const lazy = <TResult>(fn: () => TResult): (() => TResult) => {
  let executed = false;
  let value: TResult | undefined;
  return () => {
    if (executed) {
      return value as TResult;
    }
    value = fn();
    executed = true;
    return value;
  };
};
