import { createAction } from '@bigcommerce/data-store';
import { createFormPoster, FormPoster } from '@bigcommerce/form-poster';
import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader, getScriptLoader } from '@bigcommerce/script-loader';
import { EventEmitter } from 'events';
import { from } from 'rxjs';

import { BillingAddressActionCreator, BillingAddressRequestSender } from '../../../billing';
import { Cart } from '../../../cart';
import { getCart } from '../../../cart/carts.mock';
import { createCheckoutStore, CheckoutActionCreator, CheckoutActionType, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckout, getCheckoutStoreState } from '../../../checkout/checkouts.mock';
import { InvalidArgumentError, MissingDataError, MissingDataErrorType } from '../../../common/error/errors';
import { ConfigActionCreator, ConfigRequestSender } from '../../../config';
import { FormFieldsActionCreator, FormFieldsRequestSender } from '../../../form';
import { CountryActionCreator, CountryActionType, CountryRequestSender } from '../../../geography';
import { getCountries } from '../../../geography/countries.mock';
import { OrderActionCreator, OrderRequestSender } from '../../../order';
import { PaymentActionCreator, PaymentMethod, PaymentRequestSender, PaymentRequestTransformer } from '../../../payment';
import { getPaypalCommerce } from '../../../payment/payment-methods.mock';
import { ApproveActions, PaypalCommercePaymentProcessor, PaypalCommerceRequestSender, PaypalCommerceScriptLoader, StyleButtonColor, StyleButtonLabel } from '../../../payment/strategies/paypal-commerce';
import { ConsignmentActionCreator, ConsignmentActionType, ConsignmentRequestSender } from '../../../shipping';
import { getShippingOptions } from '../../../shipping/shipping-options.mock';
import { createSpamProtection, PaymentHumanVerificationHandler } from '../../../spam-protection';
import { SubscriptionsActionCreator, SubscriptionsRequestSender } from '../../../subscription';
import { CheckoutButtonInitializeOptions } from '../../checkout-button-options';
import CheckoutButtonMethodType from '../checkout-button-method-type';

import { PaypalCommerceButtonInitializeOptions } from './paypal-commerce-button-options';
import PaypalCommerceButtonStrategy from './paypal-commerce-button-strategy';

describe('PaypalCommerceButtonStrategy', () => {
    let store: CheckoutStore;
    let checkoutActionCreator: CheckoutActionCreator;
    let orderActionCreator: OrderActionCreator;
    let countryActionCreator: CountryActionCreator;
    let formPoster: FormPoster;
    let paypalOptions: PaypalCommerceButtonInitializeOptions;
    let options: CheckoutButtonInitializeOptions;
    let eventEmitter: EventEmitter;
    let strategy: PaypalCommerceButtonStrategy;
    let requestSender: RequestSender;
    let paymentMethod: PaymentMethod;
    let orderID: string;
    let actions: ApproveActions;
    let paypalCommercePaymentProcessor: PaypalCommercePaymentProcessor;
    let cart: Cart;
    let fundingSource: string;
    let messageContainer: HTMLDivElement;
    let consignmentActionCreator: ConsignmentActionCreator;
    let consignmentRequestSender: ConsignmentRequestSender;
    let billingAddressActionCreator: BillingAddressActionCreator;
    let paymentActionCreator: PaymentActionCreator;
    const paymentClient = {};
    const consignmentMock = [{
        address: {},
        shippingAddress: {
            firstName: 'AAAA',
            lastName: 'BBB',
            countryCode: 'USA',
            postalCode: '08634',
            email: 'fake@fake.fake',
            address1: 'assds',
            city: 'BGH',
        },
        lineItems: {
            itemId: '123',
            quantity: 12,
        },
        pickupOption: {
            pickupMethodId: 123,
        },
        billingAddress: {},
    }];

    beforeEach(() => {
        store = createCheckoutStore(getCheckoutStoreState());
        requestSender = createRequestSender();
        paymentMethod = { ...getPaypalCommerce() };
        cart = { ...getCart() };
        formPoster = createFormPoster();

        orderActionCreator = new OrderActionCreator(
            new OrderRequestSender(requestSender),
            new CheckoutValidator(new CheckoutRequestSender(requestSender))
        );

        countryActionCreator = new CountryActionCreator(new CountryRequestSender(requestSender, {}));
        consignmentRequestSender = new ConsignmentRequestSender(requestSender);
        billingAddressActionCreator = new BillingAddressActionCreator(new BillingAddressRequestSender(requestSender), new SubscriptionsActionCreator(new SubscriptionsRequestSender(requestSender)));
        paymentActionCreator = new PaymentActionCreator(new PaymentRequestSender(paymentClient), orderActionCreator, new PaymentRequestTransformer(), new PaymentHumanVerificationHandler(createSpamProtection(createScriptLoader())));

        checkoutActionCreator = new CheckoutActionCreator(
            new CheckoutRequestSender(requestSender),
            new ConfigActionCreator(new ConfigRequestSender(requestSender)),
            new FormFieldsActionCreator(new FormFieldsRequestSender(requestSender))
        );
        orderActionCreator = {} as OrderActionCreator;
        paymentActionCreator = {} as PaymentActionCreator;

        paypalCommercePaymentProcessor = new PaypalCommercePaymentProcessor(
            new PaypalCommerceScriptLoader(getScriptLoader()),
            new PaypalCommerceRequestSender(requestSender),
            store,
            orderActionCreator,
            paymentActionCreator
        );
        eventEmitter = new EventEmitter();
        consignmentActionCreator = new ConsignmentActionCreator(
            consignmentRequestSender,
            new CheckoutRequestSender(requestSender)
        );

        paypalOptions = {
            style: {
                color: StyleButtonColor.white,
                label: StyleButtonLabel.buynow,
                height: 45,
            },
            messagingContainer: 'paypal-commerce-cart-messaging-banner',
        };

        options = {
            containerId: 'paypalcommerce-container',
            methodId: CheckoutButtonMethodType.PAYPALCOMMERCE,
            paypalCommerce: paypalOptions,
        };

        const onShippingChangeData = {
            amount: {
                breakdown: {
                    item_total: {
                        currency_code: 'USD',
                        value: '100',
                    },
                shipping: {
                    currency_code: 'USD',
                    value: '100',
                },
                tax_total: {
                    currency_code: 'USD',
                    value: '100',
                },
                },
                currency_code: 'USD',
                value: '100',
            },
            orderID: '123',
            payment_token: 'PAYMENT_TOKEN',
            shipping_address: {
                city: 'Los-Angeles',
                postal_code: '08547',
                country_code: 'US',
                state: 'CA',
            },
            selected_shipping_option: {
                id: '123',
                amount: {
                    currency_code: 'USD',
                        value: '100',
                },
            },
            cartId: '1',
            availableShippingOptions: []
        };

        orderID = 'ORDER_ID';
        fundingSource = 'paypal';
        actions = {
            order: {
                get:  jest.fn(() => new Promise(resolve => {
                    return resolve() ;
                })),
            },
            resolve: jest.fn().mockReturnValue(Promise.resolve()),
            reject: jest.fn().mockReturnValue(Promise.reject()),
         } as ApproveActions;

        jest.spyOn(checkoutActionCreator, 'loadDefaultCheckout')
            .mockReturnValue(() => {
                return from([
                    createAction(CheckoutActionType.LoadCheckoutRequested),
                    createAction(CheckoutActionType.LoadCheckoutSucceeded, getCheckout()),
                ]);
            });

        jest.spyOn(countryActionCreator, 'loadCountries')
            .mockReturnValue(() => {
                return from([
                    createAction(CountryActionType.LoadCountriesRequested),
                    createAction(CountryActionType.LoadCountriesSucceeded, getCountries()),
                ]);
            });

        jest.spyOn(consignmentActionCreator, 'loadShippingOptions')
            .mockReturnValue(() => {
                return from([
                    createAction(ConsignmentActionType.LoadShippingOptionsRequested),
                    createAction(ConsignmentActionType.LoadShippingOptionsSucceeded, getShippingOptions()),
                ]);
            });
        jest.spyOn(consignmentActionCreator, 'updateConsignment')
            .mockReturnValue(() => {
                return from([
                    createAction(ConsignmentActionType.UpdateConsignmentRequested),
                    createAction(ConsignmentActionType.UpdateConsignmentSucceeded, getCheckout()),
                ]);
            });

        jest.spyOn(consignmentActionCreator, 'deleteConsignment')
            .mockReturnValue(() => {
                return from([
                    createAction(ConsignmentActionType.DeleteConsignmentRequested),
                    createAction(ConsignmentActionType.DeleteConsignmentSucceeded),
                ]);
            });

        jest.spyOn(paypalCommercePaymentProcessor, 'initialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(paypalCommercePaymentProcessor, 'renderButtons')
            .mockImplementation((...arg) => {
                const [, , options] = arg;

                eventEmitter.on('onClick', () => {
                    if (options.onClick) {
                        options.onClick({ fundingSource });
                    }
                });

                eventEmitter.on('onApprove', () => {
                    if (options.onApprove) {
                        options.onApprove({ orderID }, actions);
                    }
                });

                eventEmitter.on('onShippingChange', () => {
                    if (options.onShippingChange) {
                        options.onShippingChange(onShippingChangeData, actions, cart);
                    }
                });

                eventEmitter.on('onCancel', () => {
                    if (options.onCancel) {
                        options.onCancel({ orderID }, actions);
                    }
                })
            });

        jest.spyOn(paypalCommercePaymentProcessor, 'renderMessages')
            .mockImplementation(() => {} );

        jest.spyOn(formPoster, 'postForm')
            .mockImplementation(() => {});

        strategy = new PaypalCommerceButtonStrategy(
            store,
            checkoutActionCreator,
            formPoster,
            paypalCommercePaymentProcessor,
            orderActionCreator,
            countryActionCreator,
            consignmentActionCreator,
            billingAddressActionCreator,
            paymentActionCreator
        );

        jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow').mockReturnValue(paymentMethod);
        jest.spyOn(store.getState().consignments, 'getConsignmentsOrThrow').mockReturnValue(consignmentMock);

        if (paypalOptions.messagingContainer != null) {
            messageContainer = document.createElement('div');
            messageContainer.setAttribute('id', paypalOptions.messagingContainer);
            document.body.appendChild(messageContainer);
        }
    });

    afterEach(() => {
        if (paypalOptions.messagingContainer != null && document.getElementById(paypalOptions.messagingContainer)) {
                document.body.removeChild(messageContainer);
        }
    });

    it('initializes PaypalCommerce and PayPal credit disabled & messaging enabled', async () => {
        paymentMethod.initializationData.isVenmoEnabled = true;
        await strategy.initialize(options);

        const obj = {
            'client-id': 'abc',
            commit: false,
            currency: 'USD',
            'data-partner-attribution-id': undefined,
            intent: 'capture',
            'merchant-id': undefined,
            components: ['buttons', 'messages'],
            'disable-funding': [
                'card',
                'credit',
                'paylater',
            ],
            'enable-funding': ['venmo'],

        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, true);
    });

    it('initializes PaypalCommerce and PayPal credit enabled & messaging enabled', async () => {
        paymentMethod.initializationData.isVenmoEnabled = false;
        paymentMethod.initializationData.isPayPalCreditAvailable = true;

        await strategy.initialize(options);

        const obj = {
                'client-id': 'abc',
                commit: false,
                currency: 'USD',
                intent: 'capture',
                components: ['buttons', 'messages'],
                'disable-funding': [ 'card', 'venmo'],
                'enable-funding': ['credit', 'paylater'],
        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, false);
    });

    it('initializes PaypalCommerce with enabled Venmo', async () => {
        paymentMethod.initializationData.isHostedCheckoutEnabled = false;
        paymentMethod.initializationData.isVenmoEnabled = true;

        await strategy.initialize(options);

        const obj = {
            'client-id': 'abc',
            commit: false,
            currency: 'USD',
            intent: 'capture',
            components: ['buttons', 'messages'],
            'disable-funding': [
                'card',
                'credit',
                'paylater',
            ],
            'enable-funding': [
                'venmo',
            ],
        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, true);
    });

    it('Loads with intent authorize', async () => {
        paymentMethod.initializationData.isPayPalCreditAvailable = true;
        paymentMethod.initializationData.intent = 'authorize';
        paymentMethod.initializationData.isVenmoEnabled = true;

        await strategy.initialize(options);

        const obj = {
            'client-id': 'abc',
            commit: false,
            currency: 'USD',
            intent: 'authorize',
            'data-partner-attribution-id': undefined,
            components: ['buttons', 'messages'],
            'disable-funding': ['card'],
            'enable-funding': ['credit', 'paylater', 'venmo'],
            'merchant-id': undefined,
        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, true);
    });

    it('Do not call formPoster if isHostedCheckoutEnabled true in initializationData', async () => {
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;

        await strategy.initialize(options);
        eventEmitter.emit('onApprove');
        await new Promise(resolve => process.nextTick(resolve));


        expect(formPoster.postForm).toHaveBeenCalledTimes(0);
    });

    it('initializes PaypalCommerce with enabled APMs', async () => {
        paymentMethod.initializationData.availableAlternativePaymentMethods = ['sepa', 'venmo', 'sofort', 'mybank'];
        paymentMethod.initializationData.enabledAlternativePaymentMethods = ['sofort', 'mybank'];

        await strategy.initialize(options);

        const obj = {
                'client-id': 'abc',
                commit: false,
                currency: 'USD',
                'data-partner-attribution-id': undefined,
                'merchant-id': undefined,
                intent: 'capture',
                components: ['buttons', 'messages'],
                'disable-funding': ['card', 'sepa', 'venmo', 'credit', 'paylater', 'venmo'],
                'enable-funding': ['sofort', 'mybank'],
        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, undefined);
    });

    it('goes to checkout page when initializationData.isHostedCheckoutEnabled = false', async () => {
        paymentMethod.initializationData.isHostedCheckoutEnabled = false;
        await strategy.initialize(options);
        eventEmitter.emit('onApprove');
        await new Promise(resolve => process.nextTick(resolve));
        expect(formPoster.postForm).toHaveBeenCalled();
    });

    it('does not render any paypal message', async () => {
        await strategy.initialize({...options, paypalCommerce: {messagingContainer: undefined}});

        expect(paypalCommercePaymentProcessor.renderMessages).toHaveBeenCalledTimes(0);
    });

    it('initializes PaypalCommerce with disabled APMs', async () => {
        paymentMethod.initializationData.availableAlternativePaymentMethods = ['sepa', 'venmo', 'sofort', 'mybank'];
        paymentMethod.initializationData.enabledAlternativePaymentMethods = [];

        await strategy.initialize(options);

        const obj = {
                'client-id': 'abc',
                commit: false,
                currency: 'USD',
                intent: 'capture',
                'merchant-id': undefined,
                components: ['buttons', 'messages'],
                'disable-funding': [ 'card', 'sepa', 'venmo', 'sofort', 'mybank', 'credit', 'paylater', 'venmo'],
                'data-partner-attribution-id': undefined,
        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, undefined);
    });

    it('render PayPal buttons', async () => {
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;
        await strategy.initialize(options);

        const buttonOption = {
            onApprove: expect.any(Function),
            onClick: expect.any(Function),
            style: paypalOptions.style,
            onCancel: expect.any(Function),
            onShippingChange: expect.any(Function),
        };

        expect(paypalCommercePaymentProcessor.renderButtons).toHaveBeenCalledWith(cart.id, `#${options.containerId}`, buttonOption);
    });

    it('do not render PayPal messaging without banner element', async () => {
        document.body.removeChild(messageContainer);

        await strategy.initialize(options);

        expect(paypalCommercePaymentProcessor.renderMessages).not.toHaveBeenCalled();
    });

    it('render PayPal messaging with banner element', async () => {
        await strategy.initialize(options);

        expect(paypalCommercePaymentProcessor.renderMessages).toHaveBeenCalledWith(cart.cartAmount, `#${paypalOptions.messagingContainer}`);
    });

    it('post payment details to server to set checkout data when PayPalCommerce payment details are tokenized', async () => {
        paymentMethod.initializationData.isHostedCheckoutEnabled = false;
        await strategy.initialize(options);

        eventEmitter.emit('onApprove');

        await new Promise(resolve => process.nextTick(resolve));

        expect(formPoster.postForm).toHaveBeenCalledWith('/checkout.php', expect.objectContaining({
            payment_type: 'paypal',
            action: 'set_external_checkout',
            provider: 'paypalcommerce',
            order_id: orderID,
        }));
    });

    it('calls update billing address onCancel',  async () => {
        jest.spyOn(billingAddressActionCreator, 'updateAddress').mockReturnValue(Promise.resolve());
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;

        await strategy.initialize(options);
        eventEmitter.emit('onCancel');
        await new Promise(resolve => process.nextTick(resolve));

        expect(billingAddressActionCreator.updateAddress).toHaveBeenCalled();
    });

    it('calls deleteConsignment onCancel',  async () => {
        jest.spyOn(billingAddressActionCreator, 'updateAddress').mockReturnValue(true);
        jest.spyOn(consignmentActionCreator, 'deleteConsignment');
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;

        await strategy.initialize(options);
        eventEmitter.emit('onCancel');
        await new Promise(resolve => process.nextTick(resolve));

        expect(consignmentActionCreator.deleteConsignment).toHaveBeenCalled();
    });

    it('calls createConsignments onCancel',  async () => {
        jest.spyOn(billingAddressActionCreator, 'updateAddress').mockReturnValue(true);
        jest.spyOn(consignmentActionCreator, 'deleteConsignment').mockReturnValue(true);
        jest.spyOn(consignmentActionCreator, 'createConsignments');
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;

        await strategy.initialize(options);
        eventEmitter.emit('onCancel');
        await new Promise(resolve => process.nextTick(resolve));

        expect(consignmentActionCreator.createConsignments).toHaveBeenCalled();
    });

    it('calls deleteConsignment onShippingChange',  async () => {
        jest.spyOn(consignmentActionCreator, 'deleteConsignment');
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;

        await strategy.initialize(options);
        eventEmitter.emit('onShippingChange');
        await new Promise(resolve => process.nextTick(resolve));

        expect(consignmentActionCreator.deleteConsignment).toHaveBeenCalled();
    });

    it('initializes and disable all APMs when isHostedCheckoutEnabled', async () => {
        paymentMethod.initializationData.isHostedCheckoutEnabled = true;
        paymentMethod.initializationData.availableAlternativePaymentMethods = ['sepa', 'venmo', 'sofort', 'mybank'];
        paymentMethod.initializationData.enabledAlternativePaymentMethods = ['sepa', 'venmo', 'sofort', 'mybank'];

        await strategy.initialize(options);

        const obj = {
            'client-id': 'abc',
            commit: true,
            currency: 'USD',
            'data-partner-attribution-id': undefined,
            'merchant-id': undefined,
            intent: 'capture',
            components: ['buttons', 'messages'],
            'disable-funding': ['card', 'sepa', 'venmo', 'sofort', 'mybank', 'credit', 'paylater'],
            'enable-funding': ['sepa', 'venmo', 'sofort', 'mybank'],
        };

        expect(paypalCommercePaymentProcessor.initialize).toHaveBeenCalledWith(obj, undefined, undefined);
    });

    it('post payment details with credit to server to set checkout data when PayPalCommerce payment details are tokenized', async () => {
        fundingSource = 'paypalcommerce';
        paymentMethod.initializationData.isHostedCheckoutEnabled = false;

        await strategy.initialize(options);

        eventEmitter.emit('onClick');
        await new Promise(resolve => process.nextTick(resolve));
        eventEmitter.emit('onApprove');
        await new Promise(resolve => process.nextTick(resolve));

        expect(formPoster.postForm).toHaveBeenCalledWith('/checkout.php', expect.objectContaining({
            payment_type: 'paypal',
            action: 'set_external_checkout',
            provider: 'paypalcommerce',
            order_id: orderID,
        }));
    });

    describe('throws error during initialize', () => {
        it('without clientId', async () => {
            paymentMethod.initializationData.clientId = null;

            strategy = new PaypalCommerceButtonStrategy(
                store,
                checkoutActionCreator,
                formPoster,
                paypalCommercePaymentProcessor,
                orderActionCreator,
                countryActionCreator,
                consignmentActionCreator,
                billingAddressActionCreator,
                paymentActionCreator
            );

            try {
                await strategy.initialize(options);
            } catch (error) {
                expect(error).toBeInstanceOf(InvalidArgumentError);
            }
        });

        it('throws error if payment method is not loaded', async () => {
            try {
                store = createCheckoutStore();
                strategy = new PaypalCommerceButtonStrategy(
                    store,
                    checkoutActionCreator,
                    formPoster,
                    paypalCommercePaymentProcessor,
                    orderActionCreator,
                    countryActionCreator,
                    consignmentActionCreator,
                    billingAddressActionCreator,
                    paymentActionCreator
                );

                options = {
                    containerId: 'paypalcommerce-container1',
                    paypalCommerce: paypalOptions,
                } as CheckoutButtonInitializeOptions;

                await strategy.initialize(options);
            } catch (error) {
                expect(error).toBeInstanceOf(MissingDataError);
            }
        });

        it('throw error without cart', async () => {
            const state = getCheckoutStoreState();
            delete state.cart.data;

            store = createCheckoutStore(state);

            strategy = new PaypalCommerceButtonStrategy(
                store,
                checkoutActionCreator,
                formPoster,
                paypalCommercePaymentProcessor,
                orderActionCreator,
                countryActionCreator,
                consignmentActionCreator,
                billingAddressActionCreator,
                paymentActionCreator
            );
            const checkout = getCheckout();
            delete checkout.cart;

            jest.spyOn(checkoutActionCreator, 'loadDefaultCheckout')
                .mockReturnValue(() => {
                    return from([
                        createAction(CheckoutActionType.LoadCheckoutRequested),
                        createAction(CheckoutActionType.LoadCheckoutSucceeded, checkout),
                    ]);
                });

            try {
                await strategy.initialize(options);
            } catch (error) {
                expect(error).toEqual(new MissingDataError(MissingDataErrorType.MissingCart));
            }
        });
    });
});
