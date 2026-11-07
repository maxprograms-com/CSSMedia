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

export class NamedValues<T> {

    private readonly entries: Map<string, T> = new Map<string, T>();
    private readonly page: Map<string, Array<T>> = new Map<string, Array<T>>();
    private readonly atStart: Set<string> = new Set<string>();

    copy(): NamedValues<T> {
        const copy: NamedValues<T> = new NamedValues<T>();
        for (const [name, value] of this.entries) {
            copy.entries.set(name, value);
        }
        for (const [name, values] of this.page) {
            copy.page.set(name, [...values]);
        }
        for (const name of this.atStart) {
            copy.atStart.add(name);
        }
        return copy;
    }

    nextPage(): void {
        // CSS Content 3 §2.7.2: "The entry value for a page is the assignment in effect at the end of the previous page."
        for (const [name, values] of this.page) {
            this.entries.set(name, values[values.length - 1]);
        }
        this.page.clear();
        this.atStart.clear();
    }

    assign(name: string, value: T, first: boolean): void {
        let values: Array<T> | undefined = this.page.get(name);
        if (values === undefined) {
            values = [];
            this.page.set(name, values);
            if (first) {
                this.atStart.add(name);
            }
        }
        values.push(value);
    }

    value(name: string, which: string): T | undefined {
        const assigned: Array<T> | undefined = this.page.get(name);
        const entry: T | undefined = this.entries.get(name);
        switch (which) {
            case "start":
                return assigned !== undefined && this.atStart.has(name) ? assigned[0] : entry;
            case "last":
                return assigned === undefined ? entry : assigned[assigned.length - 1];
            case "first-except":
                return assigned === undefined ? entry : undefined;
            default:
                return assigned === undefined ? entry : assigned[0];
        }
    }
}
