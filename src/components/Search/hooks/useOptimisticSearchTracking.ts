import type {SearchQueryJSON} from '@components/Search/types';

import {flushDeferredWrite, getOptimisticWatchKey, hasDeferredWrite} from '@libs/deferredLayoutWrite';
import {getOriginalMessage, isMoneyRequestAction} from '@libs/ReportActionsUtils';
import {isSearchDataLoaded, isTransactionSearchType} from '@libs/SearchUIUtils';
import {getPendingSubmitFollowUpAction} from '@libs/telemetry/submitFollowUpAction';

import CONST from '@src/CONST';
import ONYXKEYS from '@src/ONYXKEYS';
import type {Transaction} from '@src/types/onyx';
import type {ReportActions} from '@src/types/onyx/ReportAction';
import type SearchResults from '@src/types/onyx/SearchResults';

import type {OnyxCollection} from 'react-native-onyx';

import {useEffect, useRef, useState} from 'react';

import type {OptimisticTrackingState, TrackingMutableState} from './useStableOptimisticSortedData';

import {OPTIMISTIC_TRACKING_TIMEOUT_MS, resolveWatchKey} from './useStableOptimisticSortedData';

type ReportKey = `${typeof ONYXKEYS.COLLECTION.REPORT}${string}`;
type TransactionKey = `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`;

function isReportEntryKey(key: string): key is ReportKey {
    return key.startsWith(ONYXKEYS.COLLECTION.REPORT);
}

function isTransactionEntryKey(key: string): key is TransactionKey {
    return key.startsWith(ONYXKEYS.COLLECTION.TRANSACTION);
}

type UseOptimisticSearchTrackingParams = {
    /** Current search results snapshot from Onyx. */
    searchResults: SearchResults | undefined;
    /** Parsed query controlling the active search (type, filters, etc.). */
    queryJSON: SearchQueryJSON;
    /** Full transactions collection used to resolve optimistic watch keys. */
    transactions: OnyxCollection<Transaction> | undefined;
    /** Report actions collection used to augment search data with optimistic IOU actions. */
    reportActions: OnyxCollection<ReportActions> | undefined;
};

/**
 * Phase 1: Call this hook BEFORE computing sortedData.
 *
 * Manages optimistic item tracking state: watch key resolution, split parent
 * swapping, data augmentation, timeouts, and cleanup.
 *
 * Returns `searchDataWithOptimisticTransaction` (used to compute filteredData -> sortedData)
 * and a `trackingState` object to pass to `useStableOptimisticSortedData`.
 */
function useOptimisticSearchTracking({searchResults, queryJSON, transactions, reportActions}: UseOptimisticSearchTrackingParams) {
    const {type} = queryJSON;

    const hasPendingWriteOnMount = hasDeferredWrite(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);
    const initialWatchKey = getOptimisticWatchKey(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);

    const mutableRef = useRef<TrackingMutableState>({
        hasPendingWriteOnMount,
        optimisticWatchKey: initialWatchKey,
        cachedOptimisticItem: null,
        cachedOptimisticItemIndex: 0,
        isCleanedUp: false,
        hasSwappedFromParent: false,
        rollbackTimeout: undefined,
    });

    const [optimisticWatchKey, setOptimisticWatchKey] = useState(() => initialWatchKey);
    const skipDeferralOnFocusRef = useRef(isSearchDataLoaded(searchResults, queryJSON) && !hasPendingWriteOnMount);

    const [shouldDeferHeavySearchWork, setShouldDeferHeavySearchWork] = useState(() => !isSearchDataLoaded(searchResults, queryJSON) || hasPendingWriteOnMount);
    const [showPendingExpensePlaceholder, setShowPendingExpensePlaceholder] = useState(() => hasPendingWriteOnMount);
    const [isOptimisticTrackingCleared, setIsOptimisticTrackingCleared] = useState(false);

    const clearOptimisticTracking = () => {
        const tracking = mutableRef.current;
        if (tracking.isCleanedUp) {
            return;
        }
        tracking.isCleanedUp = true;
        tracking.cachedOptimisticItem = null;
        tracking.optimisticWatchKey = undefined;
        setOptimisticWatchKey(undefined);
        setShowPendingExpensePlaceholder(false);
        setIsOptimisticTrackingCleared(true);
    };

    // Safety timeout: clear skeleton if the lifecycle hasn't resolved within 10s.
    useEffect(() => {
        if (!showPendingExpensePlaceholder) {
            return;
        }
        const id = setTimeout(() => setShowPendingExpensePlaceholder(false), OPTIMISTIC_TRACKING_TIMEOUT_MS);
        return () => clearTimeout(id);
    }, [showPendingExpensePlaceholder]);

    // Flush on unmount so the API.write() still executes if user navigates away.
    useEffect(
        () => () => {
            if (getPendingSubmitFollowUpAction()?.followUpAction !== CONST.TELEMETRY.SUBMIT_FOLLOW_UP_ACTION.NAVIGATE_TO_SEARCH) {
                flushDeferredWrite(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);
            }
            if (mutableRef.current.rollbackTimeout) {
                clearTimeout(mutableRef.current.rollbackTimeout);
            }
        },
        [],
    );

    // Unified watch-key effect: resolves the key when missing, then swaps from
    // split-parent to child when applicable. Merging avoids the PERF-9 pattern
    // where one effect's setState triggers another.
    useEffect(() => {
        const tracking = mutableRef.current;

        if (isOptimisticTrackingCleared || !tracking.hasPendingWriteOnMount) {
            return;
        }

        // Step 1: resolve watch key if not yet available.
        if (!optimisticWatchKey) {
            const cleanup = resolveWatchKey(tracking, setOptimisticWatchKey);
            if (!cleanup && !hasDeferredWrite(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH)) {
                clearOptimisticTracking();
            }
            return cleanup;
        }

        // Step 2: if the watched transaction is a split parent, swap to child.
        // The O(n) scan over transactions only runs when the watched tx is
        // confirmed to be a split parent (reportID === SPLIT_REPORT_ID), which
        // is a rare, single-occurrence event per optimistic lifecycle.
        // Guard: only swap once per lifecycle to prevent an infinite rAF loop
        // if the child also temporarily has SPLIT_REPORT_ID during rollback.
        if (tracking.hasSwappedFromParent) {
            return;
        }
        const watchedTx = transactions?.[optimisticWatchKey as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`];
        if (watchedTx?.reportID !== CONST.REPORT.SPLIT_REPORT_ID) {
            return;
        }

        const parentTransactionID = watchedTx.transactionID;
        const childEntry = Object.entries(transactions ?? {}).find(([, tx]) => tx?.comment?.originalTransactionID === parentTransactionID && tx.reportID !== CONST.REPORT.SPLIT_REPORT_ID);
        if (!childEntry) {
            return;
        }
        const childKey = childEntry[0] as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`;
        tracking.optimisticWatchKey = childKey;
        tracking.hasSwappedFromParent = true;
        const rafID = requestAnimationFrame(() => setOptimisticWatchKey(childKey));
        return () => cancelAnimationFrame(rafID);
    }, [isOptimisticTrackingCleared, optimisticWatchKey, transactions]);

    // Augment search data with optimistic transactions (before they appear in server snapshots).
    const searchDataWithOptimisticTransaction = (() => {
        const searchData = searchResults?.data;
        if (!searchData) {
            return searchData;
        }

        let nextSearchData = searchData;

        if (type === CONST.SEARCH.DATA_TYPES.EXPENSE_REPORT && transactions) {
            const reportIDsInSnapshot = new Set<string>();
            for (const reportKey of Object.keys(searchData)) {
                if (!isReportEntryKey(reportKey)) {
                    continue;
                }
                const report = searchData[reportKey];
                if (report?.reportID) {
                    reportIDsInSnapshot.add(report.reportID);
                }
            }

            let optimisticReportTransactions: Partial<SearchResults['data']> | undefined;
            for (const transactionKey of Object.keys(transactions)) {
                if (!isTransactionEntryKey(transactionKey)) {
                    continue;
                }
                const transaction = transactions[transactionKey];
                if (
                    !transaction?.transactionID ||
                    nextSearchData[transactionKey] ||
                    transaction.reportID === CONST.REPORT.SPLIT_REPORT_ID ||
                    !transaction.reportID ||
                    !reportIDsInSnapshot.has(transaction.reportID)
                ) {
                    continue;
                }

                optimisticReportTransactions = {
                    ...optimisticReportTransactions,
                    [transactionKey]: transaction,
                };
            }

            if (optimisticReportTransactions) {
                nextSearchData = {
                    ...nextSearchData,
                    ...optimisticReportTransactions,
                };
            }
        }

        if (!isTransactionSearchType(type) || !optimisticWatchKey || isOptimisticTrackingCleared) {
            return nextSearchData;
        }

        const optimisticTransactionKey = optimisticWatchKey.startsWith(ONYXKEYS.COLLECTION.TRANSACTION)
            ? (optimisticWatchKey as `${typeof ONYXKEYS.COLLECTION.TRANSACTION}${string}`)
            : undefined;
        const optimisticTransaction = optimisticTransactionKey ? transactions?.[optimisticTransactionKey] : undefined;
        if (
            !optimisticTransactionKey ||
            !optimisticTransaction?.transactionID ||
            nextSearchData[optimisticTransactionKey] ||
            optimisticTransaction.reportID === CONST.REPORT.SPLIT_REPORT_ID
        ) {
            return nextSearchData;
        }

        nextSearchData = {
            ...nextSearchData,
            [optimisticTransactionKey]: optimisticTransaction,
        };

        for (const [reportActionsKey, actions] of Object.entries(reportActions ?? {})) {
            if (!actions) {
                continue;
            }

            const hasOptimisticTransactionAction = Object.values(actions).some((action) => {
                if (!isMoneyRequestAction(action)) {
                    return false;
                }
                const originalMessage = getOriginalMessage(action);
                return originalMessage?.IOUTransactionID === optimisticTransaction.transactionID;
            });
            if (!hasOptimisticTransactionAction) {
                continue;
            }

            nextSearchData[reportActionsKey as `${typeof ONYXKEYS.COLLECTION.REPORT_ACTIONS}${string}`] = actions;
        }

        return nextSearchData;
    })();

    /**
     * Re-arms optimistic tracking for subsequent expense creations while Search
     * stays mounted. Called from useFocusEffect when hasDeferredWrite is detected
     * on re-focus.
     *
     * Safe to call setState here: useFocusEffect only fires while the component
     * is mounted, and React 18+ silently ignores setState on unmounted components.
     */
    const rearmTracking = () => {
        const tracking = mutableRef.current;
        tracking.hasPendingWriteOnMount = true;
        tracking.isCleanedUp = false;
        tracking.hasSwappedFromParent = false;
        tracking.cachedOptimisticItem = null;
        setIsOptimisticTrackingCleared(false);
        setShowPendingExpensePlaceholder(true);
        const latestKey = getOptimisticWatchKey(CONST.DEFERRED_LAYOUT_WRITE_KEYS.SEARCH);
        tracking.optimisticWatchKey = latestKey;
        setOptimisticWatchKey(latestKey);
    };

    const trackingState: OptimisticTrackingState = {
        mutableRef,
        optimisticWatchKey,
        isOptimisticTrackingCleared,
        clearOptimisticTracking,
        setShowPendingExpensePlaceholder,
        setOptimisticWatchKey,
    };

    return {
        showPendingExpensePlaceholder,
        shouldDeferHeavySearchWork,
        setShouldDeferHeavySearchWork,
        searchDataWithOptimisticTransaction,
        hasPendingWriteOnMountRef: mutableRef,
        skipDeferralOnFocusRef,
        rearmTracking,
        trackingState,
    };
}

export default useOptimisticSearchTracking;
