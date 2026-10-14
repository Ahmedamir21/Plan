/** Retired: the old shared-secret endpoint accepted partial fixture merges without coverage proof. */
export default function handler(_req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  return res
    .status(410)
    .json({
      error: 'LEGACY_SYNC_RETIRED',
      message:
        'Use the authenticated admin sync workflow. No data was accepted.',
    });
}
