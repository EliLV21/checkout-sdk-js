import { FormPoster } from '@bigcommerce/form-poster';
import { includes } from 'lodash';

import { BillingAddressActionCreator } from '../../../billing/';
import { CheckoutActionCreator, CheckoutStore } from '../../../checkout';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType, RequestError } from '../../../common/error/errors';
import { Country, CountryActionCreator, Region, UnitedStatesCodes, UNITED_STATES_CODES } from '../../../geography';
import { OrderActionCreator } from '../../../order';
import { PaymentActionCreator } from '../../../payment/';
import { ApproveActions, ApproveDataOptions, ButtonsOptions, ClickDataOptions, CurrentShippingAddress, FundingType, OnCancelData, PayPalCommercePaymentMethod, PaypalCommercePaymentProcessor, PaypalCommerceScriptParams, ShippingAddress, ShippingChangeData, ShippingData } from '../../../payment/strategies/paypal-commerce';
import { ConsignmentActionCreator, ConsignmentLineItem } from '../../../shipping';
import { CheckoutButtonInitializeOptions } from '../../checkout-button-options';
import CheckoutButtonStrategy from '../checkout-button-strategy';

export default class PaypalCommerceButtonStrategy implements CheckoutButtonStrategy {
    private _paymentMethod?: PayPalCommercePaymentMethod;
    private _isCredit?: boolean;
    private _currentShippingAddress?: CurrentShippingAddress;
    private _isVenmoEnabled?: boolean;
    private _isVenmo?: boolean;
    private _shippingData?: ShippingData;

    constructor(
        private _store: CheckoutStore,
        private _checkoutActionCreator: CheckoutActionCreator,
        private _formPoster: FormPoster,
        private _paypalCommercePaymentProcessor: PaypalCommercePaymentProcessor,
        private _orderActionCreator: OrderActionCreator,
        private _countryActionCreator: CountryActionCreator,
        private _consignmentActionCreator: ConsignmentActionCreator,
        private _billingAddressActionCreator: BillingAddressActionCreator,
        private _paymentActionCreator: PaymentActionCreator,
    ) {}

    async initialize(options: CheckoutButtonInitializeOptions): Promise<void> {
        const state = await this._store.dispatch(this._checkoutActionCreator.loadDefaultCheckout());
        this._paymentMethod = state.paymentMethods.getPaymentMethodOrThrow(options.methodId);

        if (!this._paymentMethod?.initializationData?.clientId) {
            throw new InvalidArgumentError('Unable to initialise payment because "Client Id" is not defined');
        }

        await this._store.dispatch(this._countryActionCreator.loadCountries());
        await this._store.dispatch(this._consignmentActionCreator.loadShippingOptions());

        const { isHostedCheckoutEnabled, isVenmoEnabled } = this._paymentMethod.initializationData;

        this._isVenmoEnabled = isVenmoEnabled;
        const cart = state.cart.getCartOrThrow();

        const buttonParams: ButtonsOptions = {
            onApprove: (data, actions) => this._onApproveHandler(data, actions),
            onClick: (data) =>  this._handleClickButtonProvider(data),
            onCancel: (data) => this._handleOnCancel(data),
            ...(isHostedCheckoutEnabled && { onShippingChange: (data) => this._onShippingChangeHandler(data) }),
            style: options?.paypalCommerce?.style,
        };

        const messagingContainer = options.paypalCommerce?.messagingContainer;
        const isMessagesAvailable = Boolean(messagingContainer && document.getElementById(messagingContainer));

        await this._paypalCommercePaymentProcessor.initialize(this._getParamsScript(), undefined, isVenmoEnabled);

        this._paypalCommercePaymentProcessor.renderButtons(cart.id, `#${options.containerId}`, buttonParams);

        if (isMessagesAvailable) {
            this._paypalCommercePaymentProcessor.renderMessages(cart.cartAmount, `#${messagingContainer}`);
        }

        return Promise.resolve();
    }

    deinitialize(): Promise<void> {
        this._isCredit = undefined;
        this._isVenmo = undefined;

        return Promise.resolve();
    }

    private async _handleOnCancel(_data: OnCancelData) {
        const lineItems = this._getLineItems();
        const existingConsignments = this._store.getState().consignments.getConsignmentsOrThrow();
        const { email } = this._store.getState().billingAddress.getBillingAddressOrThrow();
        const { firstName, lastName, address1 } = existingConsignments?.[0].shippingAddress || {};
        const shippingAddress = {
            ...this._shippingData,
            firstName: firstName !== 'Fake' ? firstName : '',
            lastName: lastName !== 'Fake' ? lastName: '',
            address1: address1 !== 'Fake street' ? address1 : '',
            email: email !== 'fake@fake.fake' ? email : '',
        };
        const consignment = [{
            shippingAddress,
            lineItems,
        }];
        await this._store.dispatch(this._billingAddressActionCreator.updateAddress(shippingAddress));
        if(existingConsignments?.[0]) {
            await this._store.dispatch(this._consignmentActionCreator.deleteConsignment(existingConsignments[0].id));
            await this._store.dispatch(this._consignmentActionCreator.createConsignments(consignment));
        }
    }

    private _onApproveHandler(data: ApproveDataOptions, actions: ApproveActions) {
        if (!this._paymentMethod?.initializationData) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        const { isHostedCheckoutEnabled } = this._paymentMethod.initializationData;
        return isHostedCheckoutEnabled
            ? this._onHostedMethodApprove(data, actions)
            : this._tokenizePayment(data);
    }

    private _handleClickButtonProvider({ fundingSource }: ClickDataOptions): void {
        this._isCredit = fundingSource === 'credit' || fundingSource === 'paylater';
        this._isVenmo = fundingSource === 'venmo';
    }

    private _tokenizePayment({ orderID }: ApproveDataOptions) {
        if (!orderID) {
            throw new MissingDataError(MissingDataErrorType.MissingPayment);
        }
        let provider;

        if (this._isVenmo && this._isVenmoEnabled) {
            provider = 'paypalcommercevenmo';
        } else if (this._isCredit) {
            provider = 'paypalcommercecredit';
        } else {
            provider = 'paypalcommerce';
        }

        return this._formPoster.postForm('/checkout.php', {
            payment_type: 'paypal',
            action: 'set_external_checkout',
            provider,
            order_id: orderID,
        });
    }

    private async _onHostedMethodApprove(data: ApproveDataOptions, actions: ApproveActions) {
        try {
            const orderDetails = await actions.order.get();
            const consignments = this._store.getState().consignments.getConsignmentsOrThrow();
            const lineItems = this._getLineItems();
            if (!this._paymentMethod?.id) {
                throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
            }
            const methodId = this._paymentMethod?.id;
            const shippingAddress = {
                ...this._currentShippingAddress,
                firstName: orderDetails.payer.name.given_name,
                lastName: orderDetails.payer.name.surname,
                email: orderDetails.payer.email_address,
                address1: orderDetails.purchase_units[0].shipping.address.address_line_1,
            };
            const consignment = {
                id: consignments[0].id,
                shippingAddress,
                lineItems,
            };
            await this._store.dispatch(this._billingAddressActionCreator.updateAddress(shippingAddress));

            await this._store.dispatch(this._consignmentActionCreator.updateConsignment(consignment));

            const submitOrderPayload = {};
            const submitOrderOptions = {
                params: {
                    methodId,
                },
            };

            await this._store.dispatch(this._orderActionCreator.submitOrder(submitOrderPayload, submitOrderOptions));

            const paymentData =  {
                formattedPayload: {
                    vault_payment_instrument: null,
                    set_as_default_stored_instrument: null,
                    device_info: null,
                    method_id: methodId,
                    paypal_account: {
                        order_id: data.orderID,
                    },
                },
            };
            await this._store.dispatch(this._paymentActionCreator.submitPayment({methodId,paymentData}));
            window.location.assign('/checkout/order-confirmation');
        } catch (e) {
            throw new RequestError(e);
        }
    }

    private async _onShippingChangeHandler(data: ShippingChangeData) {
        const state = this._store.getState();
        const cart = state.cart.getCartOrThrow();
        const { id: selectedShippingOptionId } = data.selected_shipping_option || {};
        const shippingAddress = await this._transformToAddress(data.shipping_address);
        this._currentShippingAddress = shippingAddress;
        const lineItems = this._getLineItems();
        const consignments = [{ shippingAddress, lineItems }];
        const existingConsignments = state.consignments.getConsignmentsOrThrow();
        if (existingConsignments?.[0]) {
            await this._store.dispatch(this._consignmentActionCreator.deleteConsignment(existingConsignments[0].id));
        }
          const updatedState = await this._store.dispatch(this._consignmentActionCreator.createConsignments(consignments));

        const { availableShippingOptions, id: consignmentId } = updatedState.consignments.getConsignmentsOrThrow()[0] || {};
        const { id: recommendedShippingOptionId } = availableShippingOptions?.find(option => option.isRecommended) || {};
        const isSelectedOptionExist = selectedShippingOptionId && availableShippingOptions?.find(option => option.id === selectedShippingOptionId);
        await this._store.dispatch(this._billingAddressActionCreator.updateAddress(shippingAddress));

        await this._store.dispatch(this._consignmentActionCreator.updateConsignment({
            id: consignmentId,
            shippingOptionId: isSelectedOptionExist ? selectedShippingOptionId : recommendedShippingOptionId
        }));

        await this._paypalCommercePaymentProcessor.setShippingOptions({
            ...data,
            cartId: cart.id,
            availableShippingOptions,
        });
    }

    private _getUSStateByCode(code: string) {
        return  UNITED_STATES_CODES.find((state: UnitedStatesCodes) => {
            return state.name === code && state.abbreviation;
        });
    }

    private async _transformToAddress(contact: ShippingAddress) {
        const state = this._store.getState();
        const countries = state.countries.getCountries();
        const addressCountry = countries?.find((country: Country) => (
            country.code === (contact.country_code || '').toUpperCase()));
        const stateAddress = addressCountry?.subdivisions.find((region: Region) => (
            region.code === contact.state?.toUpperCase() || region.code === this._getUSStateByCode(contact.state)?.abbreviation));
        const existingConsignment = this._store.getState().consignments.getConsignmentsOrThrow();

        if (!stateAddress && !contact.postal_code) {
            throw new InvalidArgumentError('Invalid Address');
        }

        const { firstName, lastName, address1, email } = existingConsignment?.[0]?.shippingAddress || {};
        const shippingData = {
            city: contact.city,
            postalCode: stateAddress?.code || contact.postal_code,
            countryCode: contact.country_code,
            firstName: firstName ? firstName : 'Fake',
            lastName: lastName ? lastName :'Fake',
            address1: address1 ? address1 : 'Fake street',
            email: email ? email : 'fake@fake.fake'
        };
        this._shippingData = shippingData;
        return shippingData;
    }

    private _getLineItems(): ConsignmentLineItem[] {
        const state = this._store.getState();
        const cart = state.cart.getCartOrThrow();
        const { digitalItems, physicalItems  } = cart.lineItems;
        return [...digitalItems, ...physicalItems].map(({ id, quantity }) => ({
            itemId: id,
            quantity,
        }));
    }

    private _getParamsScript(): PaypalCommerceScriptParams {
        const cart  = this._store.getState().cart.getCart();
        if (!this._paymentMethod?.initializationData) {
            throw new MissingDataError(MissingDataErrorType.MissingPaymentMethod);
        }

        const {
            clientId,
            intent,
            isPayPalCreditAvailable,
            merchantId,
            attributionId,
            availableAlternativePaymentMethods = [],
            enabledAlternativePaymentMethods = [],
            isVenmoEnabled,
            isHostedCheckoutEnabled,
        } = this._paymentMethod.initializationData;

        const disableFunding: FundingType = [ 'card' ];
        const enableFunding: FundingType = enabledAlternativePaymentMethods.slice();

        /**
         *  The default value is different depending on the countries,
         *  therefore there's a need to add credit, paylater or APM name to enable/disable funding explicitly
         */
        availableAlternativePaymentMethods.forEach(apm => {
            if (!includes(enabledAlternativePaymentMethods, apm) || isHostedCheckoutEnabled) {
                disableFunding.push(apm);
            }
        });

        if (isPayPalCreditAvailable) {
            enableFunding.push('credit', 'paylater');
        } else {
            disableFunding.push('credit', 'paylater');
        }

        if (isVenmoEnabled) {
            enableFunding.push('venmo');
        } else if (!enableFunding.includes('venmo')) {
            disableFunding.push('venmo');
        }

        return {
            'client-id': clientId,
            'merchant-id': merchantId,
            commit: !!isHostedCheckoutEnabled,
            currency: cart?.currency.code,
            components: ['buttons', 'messages'],
            'disable-funding': disableFunding,
            ...(enableFunding.length && {'enable-funding': enableFunding}),
            intent,
            'data-partner-attribution-id': attributionId,
        };
    }
}
