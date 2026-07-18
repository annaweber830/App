import {renderHook, waitFor} from '@testing-library/react-native';

import type {SearchQueryJSON} from '@components/Search/types';

import useSearchPageSetup from '@hooks/useSearchPageSetup';

import CONST from '@src/CONST';
import type SearchResults from '@src/types/onyx/SearchResults';

const mockSearch = jest.fn();
const mockOpenSearch = jest.fn();
const mockSaveLastSearchParams = jest.fn();
const mockClearSelectedTransactions = jest.fn();

let mockShouldCalculateTotals = false;
let mockCurrentSearchResults: SearchResults | undefined;

jest.mock('@components/Search/SearchContext', () => ({
    useSearchQueryContext: () => ({currentSearchKey: undefined}),
    useSearchResultsContext: () => ({currentSearchResults: mockCurrentSearchResults, shouldUseLiveData: false}),
    useSearchSelectionActions: () => ({clearSelectedTransactions: mockClearSelectedTransactions}),
}));

jest.mock('@hooks/useNetwork', () => ({
    __esModule: true,
    default: () => ({isOffline: false}),
}));

jest.mock('@hooks/useSearchShouldCalculateTotals', () => ({
    __esModule: true,
    default: () => mockShouldCalculateTotals,
}));

jest.mock('@libs/actions/ReportNavigation', () => ({
    saveLastSearchParams: (...args: unknown[]) => mockSaveLastSearchParams(...args),
}));

jest.mock('@libs/actions/Search', () => ({
    openSearch: (...args: unknown[]) => mockOpenSearch(...args),
    search: (...args: unknown[]) => mockSearch(...args),
}));

jest.mock('@libs/deferredLayoutWrite', () => ({
    hasDeferredWrite: () => false,
}));

jest.mock('@libs/SearchUIUtils', () => ({
    isSearchDataLoaded: (searchResults: SearchResults | undefined, query: SearchQueryJSON | undefined) =>
        (searchResults?.data != null || searchResults?.errors != null) && searchResults?.search?.type === query?.type && searchResults?.search?.hash === query?.hash,
}));

jest.mock('@react-navigation/native', () => ({
    useFocusEffect: jest.fn(),
}));

const queryJSON = {
    hash: 123,
    type: CONST.SEARCH.DATA_TYPES.EXPENSE,
} as SearchQueryJSON;

function getSearchResults(isLoading: boolean): SearchResults {
    return {
        data: [],
        search: {
            hash: queryJSON.hash,
            type: queryJSON.type,
            isLoading,
            count: null,
        },
    } as unknown as SearchResults;
}

describe('useSearchPageSetup', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockShouldCalculateTotals = false;
        mockCurrentSearchResults = getSearchResults(false);
    });

    it('requests totals once when a loaded ad-hoc search becomes saved', async () => {
        const {rerender} = renderHook(() => useSearchPageSetup(queryJSON));
        expect(mockSearch).not.toHaveBeenCalled();

        mockShouldCalculateTotals = true;
        rerender({});

        await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
        expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({queryJSON, shouldCalculateTotals: true}));

        mockCurrentSearchResults = {...getSearchResults(false), errors: {test: 'failed'}} as unknown as SearchResults;
        rerender({});
        expect(mockSearch).toHaveBeenCalledTimes(1);
    });

    it('requests missing totals for an already-saved loaded snapshot on mount', async () => {
        mockShouldCalculateTotals = true;
        renderHook(() => useSearchPageSetup(queryJSON));

        await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
        expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({queryJSON, shouldCalculateTotals: true}));
    });

    it('waits for an in-flight ad-hoc search before requesting totals', async () => {
        mockCurrentSearchResults = getSearchResults(true);
        const {rerender} = renderHook(() => useSearchPageSetup(queryJSON));

        mockShouldCalculateTotals = true;
        rerender({});
        expect(mockSearch).not.toHaveBeenCalled();

        mockCurrentSearchResults = getSearchResults(false);
        rerender({});

        await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
        expect(mockSearch).toHaveBeenCalledWith(expect.objectContaining({queryJSON, shouldCalculateTotals: true}));
    });
});
