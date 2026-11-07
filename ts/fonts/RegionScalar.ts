/*******************************************************************************
 * Copyright (c) 2026 Maxprograms. All rights reserved.
 *
 * Licensed under the Business Source License 1.1 (the "License");
 * you may not use this file except in compliance with the License.
 *
 * Change Date: 2030-11-01
 * Change License: Mozilla Public License, v. 2.0
 *
 * Additional Use Grant:
 * You may make production use of the Licensed Work for personal use,
 * educational use, and academic research. "Personal use" means use by an
 * individual for their own purposes, and not on behalf of an employer, client
 * or other organization. You may also make production use of the Licensed Work
 * for trial purposes for a period of up to 30 days.
 *
 * You may obtain a copy of the License at https://spdx.org/licenses/BUSL-1.1.html
 * or in the LICENSE file provided in the root of this repository.
 *******************************************************************************/

export class RegionScalar {

    compute(starts: Float64Array, peaks: Float64Array, ends: Float64Array, coordinates: Float64Array): number {
        // OpenType Font Variations Overview, "Algorithm for Interpolation of Instance Values".
        let scalar: number = 1;
        for (let axis: number = 0; axis < peaks.length; axis++) {
            const start: number = starts[axis];
            const peak: number = peaks[axis];
            const end: number = ends[axis];
            const value: number = axis < coordinates.length ? coordinates[axis] : 0;
            if (start > peak || peak > end || (start < 0 && end > 0 && peak !== 0) || peak === 0 || value === peak) {
                continue;
            }
            if (value < start || value > end) {
                return 0;
            }
            scalar *= value < peak ? (value - start) / (peak - start) : (end - value) / (end - peak);
        }
        return scalar;
    }
}
