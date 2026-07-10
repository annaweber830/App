import useLocalize from '@hooks/useLocalize';

import {adjustRemainingSplitShares} from '@libs/actions/IOU/Split';
import {validateSplitShares} from '@libs/MoneyRequestUtils';

import type {TranslationPaths} from '@src/languages/types';
import type {Transaction} from '@src/types/onyx';

import type {OnyxEntry} from 'react-native-onyx';

import {useEffect} from 'react';

type SplitBillControllerProps = {
    transaction: OnyxEntry<Transaction>;
    isTypeSplit: boolean;
    iouAmount: number;
    iouCurrencyCode: string | undefined;
    currentUserAccountID: number;
    isFocused: boolean;
    onFormError: (error: TranslationPaths | '') => void;
};

/**
 * Side-effect-only component that validates split share amounts
 * and adjusts remaining split shares when the transaction changes.
 */
function SplitBillController({transaction, isTypeSplit, iouAmount, iouCurrencyCode, currentUserAccountID, isFocused, onFormError}: SplitBillControllerProps) {
    const {translate} = useLocalize();

    useEffect(() => {
        if (!isTypeSplit || !transaction?.splitShares || !isFocused) {
            return;
        }

        // The guard above already returns early when splitShares is missing, so undefined here means "valid" -> clear the error.
        onFormError(validateSplitShares(transaction, iouAmount, currentUserAccountID) ?? '');
    }, [isFocused, transaction, isTypeSplit, transaction?.splitShares, currentUserAccountID, iouAmount, iouCurrencyCode, onFormError, translate]);

    useEffect(() => {
        if (!isTypeSplit || !transaction?.splitShares) {
            return;
        }
        adjustRemainingSplitShares(transaction);
    }, [isTypeSplit, transaction]);

    return null;
}

SplitBillController.displayName = 'SplitBillController';

export default SplitBillController;
