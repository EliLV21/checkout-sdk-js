import Country from './country';
import { CountryResponseBody } from './country-responses';
import CountryState from './country-state';

export function getCountries(): Country[] {
    return [
        getAustralia(),
        getUnitedStates(),
        getJapan(),
    ];
}

export function getCountriesResponseBody(): CountryResponseBody {
    return {
        meta: {},
        data: getCountries(),
    };
}

export function getCountriesState(): CountryState {
    return {
        data: getCountries(),
        errors: {},
        statuses: {},
    };
}

export function getAustralia(): Country {
    return {
        id: '1',
        code: 'AU',
        name: 'Australia',
        subdivisions: [
            { id: 1, code: 'NSW', name: 'New South Wales' },
            { id: 2,code: 'VIC', name: 'Victoria' },
        ],
        hasPostalCodes: true,
        requiresState: true,
    };
}

export function getUnitedStates(): Country {
    return {
        id: '2',
        code: 'US',
        name: 'United States',
        hasPostalCodes: true,
        subdivisions: [
            { id: 1, code: 'CA', name: 'California' },
            { id:2,  code: 'TX', name: 'Texas' },
        ],
        requiresState: false,
    };
}

export function getJapan(): Country {
    return {
        id: '4',
        code: 'JP',
        name: 'Japan',
        hasPostalCodes: false,
        subdivisions: [],
        requiresState: false,
    };
}
