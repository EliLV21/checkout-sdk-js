import { BillingAddressActionCreator, BillingAddressRequestBody } from '../../../billing';
import { CheckoutActionCreator, CheckoutStore } from '../../../checkout';
import { InvalidArgumentError } from '../../../common/error/errors';
import { OrderActionCreator } from '../../../order';
import { PaymentActionCreator } from '../../../payment';
import { PaymentMethodClientUnavailableError } from '../../../payment/errors';
import { ConsignmentActionCreator, ShippingOption } from '../../../shipping';
import { ApproveCallbackActions, ApproveCallbackPayload, CompleteCallbackDataPayload, PaypalCheckoutButtonOptions, PaypalCommerceRequestSender, PaypalCommerceScriptLoader, PaypalCommerceSDK, ShippingAddressChangeCallbackPayload, ShippingOptionChangeCallbackPayload } from '../../../payment/strategies/paypal-commerce';
import { CheckoutButtonInitializeOptions } from '../../checkout-button-options';

import CheckoutButtonStrategy from '../checkout-button-strategy';
import { PaypalCommerceInlineCheckoutButtonInitializeOptions } from './paypal-commerce-inline-checkout-button-options';

export default class PaypalCommerceInlineCheckoutButtonStrategy implements CheckoutButtonStrategy {
    constructor(
        private _store: CheckoutStore,
        private _checkoutActionCreator: CheckoutActionCreator,
        private _paypalScriptLoader: PaypalCommerceScriptLoader,
        private _paypalCommerceRequestSender: PaypalCommerceRequestSender,
        private _orderActionCreator: OrderActionCreator,
        private _consignmentActionCreator: ConsignmentActionCreator,
        private _billingAddressActionCreator: BillingAddressActionCreator,
        private _paymentActionCreator: PaymentActionCreator
    ) {}

    async initialize(options: CheckoutButtonInitializeOptions): Promise<void> {
        const { methodId, paypalcommerceinline } = options;

        if (!methodId) {
            throw new InvalidArgumentError('Unable to initialize payment because "options.methodId" argument is not provided.');
        }

        if (!paypalcommerceinline) {
            throw new InvalidArgumentError('Unable to initialize payment because "options.paypalcommerceinline" argument is not provided.');
        }

        await this._store.dispatch(this._checkoutActionCreator.loadDefaultCheckout());

        const state = this._store.getState();
        const currencyCode = state.cart.getCartOrThrow().currency.code;
        const paymentMethod = state.paymentMethods.getPaymentMethodOrThrow(methodId);
        const paypalCommerceSdk = await this._paypalScriptLoader.getPayPalSDK(paymentMethod, currencyCode, false);

        if (!paypalCommerceSdk) {
            throw new PaymentMethodClientUnavailableError();
        }

        this._renderButton(methodId, paypalCommerceSdk, paypalcommerceinline);
    }

    deinitialize(): Promise<void> {
        return Promise.resolve();
    }

    private _renderButton(
        methodId: string,
        paypalCommerceSdk: PaypalCommerceSDK,
        paypalcommerceinline: PaypalCommerceInlineCheckoutButtonInitializeOptions,
    ): void {
        const {
            acceleratedCheckoutContainerDataId,
            buttonContainerDataId,
            buttonContainerClassName,
            nativeCheckoutButtonDataId,
            style,
            onComplete,
        } = paypalcommerceinline;

        if (!acceleratedCheckoutContainerDataId) {
            throw new InvalidArgumentError(`Unable to initialize payment because "options.paypalcommerceinline.acceleratedCheckoutContainerDataId" argument is not provided.`);
        }

        if (!buttonContainerDataId) {
            throw new InvalidArgumentError(`Unable to initialize payment because "options.paypalcommerceinline.buttonContainerDataId" argument is not provided.`);
        }

        if (!nativeCheckoutButtonDataId) {
            throw new InvalidArgumentError(`Unable to initialize payment because "options.paypalcommerceinline.nativeCheckoutButtonDataId" argument is not provided.`);
        }

        if (!onComplete || typeof onComplete !== 'function') {
            throw new InvalidArgumentError(`Unable to initialize payment because "options.paypalcommerceinline.onComplete" argument is not provided or it is not a function.`);
        }

        const fundingSource = paypalCommerceSdk.FUNDING.CARD;

        const buttonRenderOptions: PaypalCheckoutButtonOptions = {
            experience: 'accelerated',
            fundingSource,
            style,
            createOrder: () => this._createOrder(methodId),
            onShippingAddressChange: (data: ShippingAddressChangeCallbackPayload) => this._onShippingAddressChange(data),
            onShippingOptionsChange: (data: ShippingOptionChangeCallbackPayload) => this._onShippingOptionsChange(data),
            onApprove: (data: ApproveCallbackPayload, actions: ApproveCallbackActions) => this._onApprove(data, actions, methodId),
            onComplete: (data: CompleteCallbackDataPayload) => this._onComplete(data, methodId, onComplete),
            onError: (error: Error) => this._onError(error, buttonContainerDataId, nativeCheckoutButtonDataId),
        };

        const paypalButtonRender = paypalCommerceSdk.Buttons(buttonRenderOptions);

        if (paypalButtonRender.isEligible()) {
            this._hideNativeCheckoutButton(nativeCheckoutButtonDataId);

            this._createPayPalButtonContainer(acceleratedCheckoutContainerDataId, buttonContainerDataId, buttonContainerClassName);
            paypalButtonRender.render(`[${buttonContainerDataId}]`);
        }
    }

    private async _createOrder(methodId: string): Promise<string> {
        const state = this._store.getState();
        const cart = state.cart.getCartOrThrow();

        const { orderId } = await this._paypalCommerceRequestSender.createOrder(cart.id, methodId);

        return orderId;
    }

    private async _onShippingAddressChange(data: ShippingAddressChangeCallbackPayload): Promise<void> {
        const address = this._getAddress({
            city: data.shippingAddress.city,
            countryCode: data.shippingAddress.country_code,
            postalCode: data.shippingAddress.postal_code,
            stateOrProvinceCode: data.shippingAddress.state,
        });

        // Info: we use the same address to fill billing and consignment addresses to have valid quota on BE for order updating process
        // on this stage we don't have access to valid customer's address accept shipping data
        await this._store.dispatch(this._billingAddressActionCreator.updateAddress(address));
        await this._store.dispatch(this._consignmentActionCreator.updateAddress(address));

        const shippingOption = this._getShippingOptionOrThrow();

        await this._store.dispatch(this._consignmentActionCreator.selectShippingOption(shippingOption.id));
        await this._updateOrder();
    }

    private async _onShippingOptionsChange(data: ShippingOptionChangeCallbackPayload): Promise<void> {
        const shippingOption = this._getShippingOptionOrThrow(data.selectedShippingOption?.id);

        await this._store.dispatch(this._consignmentActionCreator.selectShippingOption(shippingOption.id));
        await this._updateOrder();
    }

    private async _onApprove(
        data: ApproveCallbackPayload,
        actions: ApproveCallbackActions,
        methodId: string,
    ): Promise<boolean> {
        const state = this._store.getState();
        const cart = state.cart.getCartOrThrow();
        const orderDetails = await actions.order.get();

        if (cart.lineItems.physicalItems.length > 0) {
            const { payer, purchase_units } = orderDetails;
            const shippingAddress = purchase_units?.[0]?.shipping?.address || {};

            const address = this._getAddress({
                firstName: payer.name.given_name,
                lastName: payer.name.surname,
                email: payer.email_address,
                address1: shippingAddress.address_line_1,
                city: shippingAddress.admin_area_2,
                countryCode: shippingAddress.country_code,
                postalCode: shippingAddress.postal_code,
                stateOrProvinceCode: shippingAddress.admin_area_1,
            });

            await this._store.dispatch(this._billingAddressActionCreator.updateAddress(address));
            await this._store.dispatch(this._consignmentActionCreator.updateAddress(address));
            await this._updateOrder();
        } else {
            const { payer } = orderDetails;

            const address = this._getAddress({
                firstName: payer.name.given_name,
                lastName: payer.name.surname,
                email: payer.email_address,
                address1: payer.address.address_line_1,
                city: payer.address.admin_area_2,
                countryCode: payer.address.country_code,
                postalCode: payer.address.postal_code,
                stateOrProvinceCode: payer.address.admin_area_1,
            });

            await this._store.dispatch(this._billingAddressActionCreator.updateAddress(address));
        }

        await this._store.dispatch(this._orderActionCreator.submitOrder({}, { params: { methodId } }));
        await this._submitPayment(methodId, data.orderID);

        return true;
    }

    private async _onComplete(
        data: CompleteCallbackDataPayload,
        methodId: string,
        callback?: () => void
    ): Promise<void> {
        await this._submitPayment(methodId, data.orderID);

        if (callback) {
            callback();
        }
    }

    private _onError(error: Error, buttonContainerDataId: string, nativeCheckoutButtonDataId: string): void {
        this._removePayPalContainer(buttonContainerDataId);
        this._showNativeCheckoutButton(nativeCheckoutButtonDataId);

        throw new Error(error.message);
    }

    private async _updateOrder(): Promise<void> {
        const state = this._store.getState();
        const cart = state.cart.getCartOrThrow();
        const consignment = state.consignments.getConsignmentsOrThrow()[0];

        await this._paypalCommerceRequestSender.updateOrder({
            availableShippingOptions: consignment?.availableShippingOptions,
            cartId: cart.id,
            selectedShippingOption: consignment?.selectedShippingOption,
        });
    }

    private async _submitPayment(methodId: string, orderId: string): Promise<void> {
        const paymentData =  {
            formattedPayload: {
                vault_payment_instrument: null,
                set_as_default_stored_instrument: null,
                device_info: null,
                method_id: methodId,
                paypal_account: {
                    order_id: orderId,
                },
            },
        };

        await this._store.dispatch(this._paymentActionCreator.submitPayment({ methodId, paymentData }));
    }

    private _getShippingOptionOrThrow(selectedShippingOptionId?: string): ShippingOption {
        const state = this._store.getState();
        const consignment = state.consignments.getConsignmentsOrThrow()[0];

        const availableShippingOptions = consignment?.availableShippingOptions || [];

        const recommendedShippingOption = availableShippingOptions.find(option => option.isRecommended);
        const selectedShippingOption = selectedShippingOptionId
            ? availableShippingOptions.find(option => option.id === selectedShippingOptionId)
            : availableShippingOptions.find(option => option.id === consignment?.selectedShippingOption?.id);

        const shippingOptionToSelect = selectedShippingOption || recommendedShippingOption;

        if (!shippingOptionToSelect) {
            throw new Error('Your order can\'t be shipped to this address');
        }

        return shippingOptionToSelect;
    }

    private _getAddress(address?: Partial<BillingAddressRequestBody>): BillingAddressRequestBody {
        return {
            firstName: address?.firstName || '',
            lastName: address?.lastName || '',
            email: address?.email || '',
            phone: '',
            company: '',
            address1: address?.address1 || '',
            address2: '',
            city: address?.city || '',
            countryCode: address?.countryCode || '',
            postalCode: address?.postalCode || '',
            stateOrProvince: '',
            stateOrProvinceCode: address?.stateOrProvinceCode || '',
            customFields: [],
        };
    }

    private _getElementByDataId(dataId: string): HTMLElement | null {
        return document.querySelector(`[${dataId}]`);
    }

    private _createPayPalButtonContainer(
        acceleratedCheckoutContainerDataId: string,
        buttonContainerDataId: string,
        buttonContainerClassName = 'PaypalCommerceInlineButton',
    ): void {
        const paypalButtonContainer = document.createElement('div');
        paypalButtonContainer.setAttribute('class', buttonContainerClassName);
        paypalButtonContainer.setAttribute(buttonContainerDataId, '');

        const container = this._getElementByDataId(acceleratedCheckoutContainerDataId);

        if (container) {
            container.innerHTML = "";
            container.append(paypalButtonContainer);
        }
    }

    private _showNativeCheckoutButton(nativeCheckoutButtonDataId: string): void {
        const nativeCheckoutButton = this._getElementByDataId(nativeCheckoutButtonDataId);

        if (nativeCheckoutButton) {
            nativeCheckoutButton.removeAttribute('style');
        }
    }

    private _hideNativeCheckoutButton(nativeCheckoutButtonDataId: string): void {
        const nativeCheckoutButton = this._getElementByDataId(nativeCheckoutButtonDataId);

        if (nativeCheckoutButton) {
            nativeCheckoutButton.setAttribute('style', 'display: none');
        }
    }

    private _removePayPalContainer(buttonContainerDataId: string): void {
        const paypalButtonContainer = this._getElementByDataId(buttonContainerDataId);

        if (paypalButtonContainer?.parentNode) {
            paypalButtonContainer.parentNode.removeChild(paypalButtonContainer);
        }
    }
}
