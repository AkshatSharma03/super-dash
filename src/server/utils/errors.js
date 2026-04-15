export function errorMessage(err, fallback = 'Unexpected error') {
  return err instanceof Error && err.message ? err.message : fallback;
}
