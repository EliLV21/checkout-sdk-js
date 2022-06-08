export default interface Country {
    id: string;
    code: string;
    name: string;
    hasPostalCodes: boolean;
    subdivisions: Region[];
    requiresState: boolean;
}

export interface Region {
    id: number;
    code: string;
    name: string;
}

export interface GetCountryResponse {
    data: Country[];
}

export interface UnitedStatesCodes {
    name: string;
    abbreviation: string;
}
