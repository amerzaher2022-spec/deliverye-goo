import data from './data/district.json' with { type: 'json' };
import type { DistrictData } from './types';

export const district = data as unknown as DistrictData;
