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

export const SPACE_DISCARDING_RANGES: ReadonlyArray<readonly [number, number]> = [
    [0x2E80, 0x2FDF],
    [0x2FF0, 0x30FF],
    [0x3190, 0x319F],
    [0x31C0, 0x31FF],
    [0x3300, 0x4DBF],
    [0x4E00, 0xA4CF],
    [0xF900, 0xFAFF],
    [0xFE10, 0xFE1F],
    [0xFE30, 0xFE6F],
    [0xFF00, 0xFFEF],
    [0x1AFF0, 0x1B16F],
    [0x20000, 0x2A6DF],
    [0x2A700, 0x2EE5F],
    [0x2F800, 0x2FA1F],
    [0x30000, 0x3347F]
];
