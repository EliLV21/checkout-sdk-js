import { createClient as createPaymentClient } from '@bigcommerce/bigpay-client';
import { createAction, createErrorAction } from '@bigcommerce/data-store';
import { createFormPoster, FormPoster } from '@bigcommerce/form-poster';
import { createRequestSender, RequestSender } from '@bigcommerce/request-sender';
import { createScriptLoader } from '@bigcommerce/script-loader';
import { of, Observable } from 'rxjs';

import { createPaymentStrategyRegistry, createPaymentStrategyRegistryV2, PaymentActionCreator, PaymentMethod } from '../..';
import { createCheckoutStore, CheckoutRequestSender, CheckoutStore, CheckoutValidator } from '../../../checkout';
import { getCheckoutStoreState } from '../../../checkout/checkouts.mock';
import { InvalidArgumentError, MissingDataError, NotInitializedError, RequestError } from '../../../common/error/errors';
import { getResponse } from '../../../common/http-request/responses.mock';
import { getConfig } from '../../../config/configs.mock';
import { FinalizeOrderAction, OrderActionCreator, OrderActionType, OrderRequestBody, OrderRequestSender, SubmitOrderAction } from '../../../order';
import { OrderFinalizationNotRequiredError } from '../../../order/errors';
import { getOrderRequestBody } from '../../../order/internal-orders.mock';
import { createSpamProtection, PaymentHumanVerificationHandler, SpamProtectionActionCreator, SpamProtectionRequestSender } from '../../../spam-protection';
import { createPaymentIntegrationService } from '../../../payment-integration';
import { PaymentArgumentInvalidError } from '../../errors';
import { PaymentActionType, SubmitPaymentAction } from '../../payment-actions';
import { getAmazonPayV2, getPaymentMethodsState } from '../../payment-methods.mock';
import { PaymentInitializeOptions } from '../../payment-request-options';
import PaymentRequestSender from '../../payment-request-sender';
import PaymentRequestTransformer from '../../payment-request-transformer';
import PaymentStrategyActionCreator from '../../payment-strategy-action-creator';
import { PaymentStrategyActionType } from '../../payment-strategy-actions';
import { getErrorPaymentResponseBody } from '../../payments.mock';

import { AmazonPayV2PaymentProcessor } from '.';
import AmazonPayV2PaymentInitializeOptions from './amazon-pay-v2-payment-initialize-options';
import AmazonPayV2PaymentStrategy from './amazon-pay-v2-payment-strategy';
import { getAmazonPayV2ButtonParamsMock, getAmazonPayV2Ph4ButtonParamsMock } from './amazon-pay-v2.mock';
import createAmazonPayV2PaymentProcessor from './create-amazon-pay-v2-payment-processor';
import { AmazonPayV2ButtonParams, AmazonPayV2NewButtonParams } from './amazon-pay-v2';

describe('AmazonPayV2PaymentStrategy', () => {
    let amazonPayV2PaymentProcessor: AmazonPayV2PaymentProcessor;
    let editMethodButton: HTMLDivElement;
    let finalizeOrderAction: Observable<FinalizeOrderAction>;
    let formPoster: FormPoster;
    let orderActionCreator: OrderActionCreator;
    let paymentHumanVerificationHandler: PaymentHumanVerificationHandler;
    let paymentActionCreator: PaymentActionCreator;
    let paymentMethodMock: PaymentMethod;
    let paymentStrategyActionCreator: PaymentStrategyActionCreator;
    let requestSender: RequestSender;
    let store: CheckoutStore;
    let strategy: AmazonPayV2PaymentStrategy;
    let submitOrderAction: Observable<SubmitOrderAction>;

    beforeEach(() => {
        store = createCheckoutStore(getCheckoutStoreState());
        amazonPayV2PaymentProcessor = createAmazonPayV2PaymentProcessor();
        requestSender = createRequestSender();
        formPoster = createFormPoster();

        const paymentClient = createPaymentClient(store);
        const spamProtection = createSpamProtection(createScriptLoader());
        const registry = createPaymentStrategyRegistry(store, paymentClient, requestSender, spamProtection, 'en_US');
        const paymentIntegrationService = createPaymentIntegrationService(store);
        const registryV2 = createPaymentStrategyRegistryV2(paymentIntegrationService);
        const widgetInteractionAction = of(createAction(PaymentStrategyActionType.WidgetInteractionStarted));
        const submitPaymentAction: Observable<SubmitPaymentAction> = of(createAction(PaymentActionType.SubmitPaymentRequested));;

        paymentHumanVerificationHandler = new PaymentHumanVerificationHandler(createSpamProtection(createScriptLoader()));

        orderActionCreator = new OrderActionCreator(
            new OrderRequestSender(createRequestSender()),
            new CheckoutValidator(new CheckoutRequestSender(createRequestSender()))
        );

        paymentStrategyActionCreator = new PaymentStrategyActionCreator(
            registry,
            registryV2,
            orderActionCreator,
            new SpamProtectionActionCreator(spamProtection, new SpamProtectionRequestSender(requestSender))
        );

        paymentActionCreator = new PaymentActionCreator(
            new PaymentRequestSender(createPaymentClient()),
            orderActionCreator,
            new PaymentRequestTransformer(),
            paymentHumanVerificationHandler
        );

        finalizeOrderAction = of(createAction(OrderActionType.FinalizeOrderRequested));
        submitOrderAction = of(createAction(OrderActionType.SubmitOrderRequested));
        paymentMethodMock = getAmazonPayV2();

        editMethodButton = document.createElement('div');
        editMethodButton.setAttribute('id', 'editButtonId');
        document.body.appendChild(editMethodButton);

        finalizeOrderAction = of(createAction(OrderActionType.FinalizeOrderRequested));

        jest.spyOn(amazonPayV2PaymentProcessor, 'initialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(amazonPayV2PaymentProcessor, 'deinitialize')
            .mockReturnValue(Promise.resolve());

        jest.spyOn(amazonPayV2PaymentProcessor, 'createButton')
            .mockReturnValue(undefined);

        jest.spyOn(amazonPayV2PaymentProcessor, 'prepareCheckout')
            .mockReturnValue(undefined);

        jest.spyOn(amazonPayV2PaymentProcessor, 'bindButton')
            .mockReturnValue(undefined);

        jest.spyOn(orderActionCreator, 'finalizeOrder')
            .mockReturnValue(finalizeOrderAction);

        jest.spyOn(orderActionCreator, 'submitOrder')
            .mockReturnValue(submitOrderAction);

        jest.spyOn(formPoster, 'postForm')
            .mockImplementation((_url, _data, callback = () => {}) => callback());

        jest.spyOn(paymentStrategyActionCreator, 'widgetInteraction')
            .mockImplementation(() => widgetInteractionAction);

        jest.spyOn(paymentActionCreator, 'submitPayment')
            .mockReturnValue(submitPaymentAction);

        strategy = new AmazonPayV2PaymentStrategy(store,
            paymentStrategyActionCreator,
            orderActionCreator,
            paymentActionCreator,
            amazonPayV2PaymentProcessor
        );
    });

    afterEach(async () => {
        await strategy.deinitialize();

        if (editMethodButton.parentElement === document.body) {
            document.body.removeChild(editMethodButton);
        } else {
            const shippingButton = document.getElementById('editButtonId');
            if (shippingButton) {
                document.body.removeChild(shippingButton);
            }
        }
    });

    it('creates an instance of AmazonPayV2PaymentStrategy', () => {
        expect(strategy).toBeInstanceOf(AmazonPayV2PaymentStrategy);
    });

    describe('#initialize()', () => {
        let amazonpayv2InitializeOptions: AmazonPayV2PaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;
        const paymentToken = 'abc123';
        const changeMethodId = 'editButtonId';

        beforeEach(() => {
            amazonpayv2InitializeOptions = { editButtonId: changeMethodId };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };
        });

        it('it should initialize the payment processor', async () => {
            await strategy.initialize(initializeOptions);

            expect(amazonPayV2PaymentProcessor.initialize).toHaveBeenNthCalledWith(1, paymentMethodMock);
        });

        it('binds edit method button if paymentToken is present on initializationData', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                .mockReturnValue(paymentMethodMock);

            await strategy.initialize(initializeOptions);

            expect(amazonPayV2PaymentProcessor.bindButton).toHaveBeenCalledWith(changeMethodId, paymentToken, 'changePayment');
            expect(amazonPayV2PaymentProcessor.createButton).not.toHaveBeenCalled();
        });

        it('creates a signin button if no paymentToken is present on initializationData', async () => {
            const expectedOptions = getAmazonPayV2ButtonParamsMock() as AmazonPayV2ButtonParams;
            expectedOptions.createCheckoutSession.url = `${getConfig().storeConfig.storeProfile.shopPath}/remote-checkout/amazonpay/payment-session`;

            await strategy.initialize(initializeOptions);

            expect(amazonPayV2PaymentProcessor.bindButton).not.toHaveBeenCalled();
            expect(amazonPayV2PaymentProcessor.createButton).toHaveBeenCalledWith(`AmazonPayButton`, expectedOptions);
        });

        it('creates an additional payment button for one-time transactions', async () => {
            const expectedOptions = getAmazonPayV2Ph4ButtonParamsMock() as AmazonPayV2NewButtonParams;
            delete expectedOptions.createCheckoutSessionConfig;

            const storeConfigMock = getConfig().storeConfig;
            storeConfigMock.checkoutSettings.features = {
                'PROJECT-3483.amazon_pay_ph4': true,
                'INT-6399.amazon_pay_apb': true,
            };

            jest.spyOn(store.getState().config, 'getStoreConfigOrThrow')
                .mockReturnValue(storeConfigMock);

            await strategy.initialize(initializeOptions);

            expect(amazonPayV2PaymentProcessor.bindButton).not.toHaveBeenCalled();
            expect(amazonPayV2PaymentProcessor.createButton).toHaveBeenCalledWith(`AmazonPayButton`, expectedOptions);
        });

        it('dispatches widgetInteraction when clicking previously binded edit method button if region not US', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;
            paymentMethodMock.initializationData.region = 'uk';
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                .mockReturnValue(paymentMethodMock);

            await strategy.initialize(initializeOptions);

            const editButton = document.getElementById(changeMethodId);

            if (editButton) {
                editButton.click();
            }

            expect(paymentStrategyActionCreator.widgetInteraction).toHaveBeenCalled();
        });

        it('avoid dispatching widgetInteraction when clicking previously binded edit method button if region US', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                .mockReturnValue(paymentMethodMock);

            await strategy.initialize(initializeOptions);

            const editButton = document.getElementById(changeMethodId);

            if (editButton) {
                editButton.click();
            }

            expect(paymentStrategyActionCreator.widgetInteraction).not.toHaveBeenCalled();
        });

        it('does not bind edit method button if button do not exist', async () => {
            document.body.removeChild(editMethodButton);
            paymentMethodMock.initializationData.paymentToken = paymentToken;
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                .mockReturnValue(paymentMethodMock);

            await strategy.initialize(initializeOptions);

            expect(amazonPayV2PaymentProcessor.bindButton).not.toHaveBeenCalled();
            expect(amazonPayV2PaymentProcessor.createButton).not.toHaveBeenCalled();

            document.body.appendChild(editMethodButton);
        });

        describe('should fail if...', () => {
            test('methodId is not provided', async () => {
                initializeOptions.methodId = '';

                await expect(strategy.initialize(initializeOptions)).rejects.toThrow(InvalidArgumentError);

                expect(amazonPayV2PaymentProcessor.initialize).not.toHaveBeenCalled();
            });

            test('there is no payment method data', async () => {
                const paymentMethods = { ...getPaymentMethodsState(), data: undefined };
                const state = { ...getCheckoutStoreState(), paymentMethods };
                store = createCheckoutStore(state);
                strategy = new AmazonPayV2PaymentStrategy(
                    store,
                    paymentStrategyActionCreator,
                    orderActionCreator,
                    paymentActionCreator,
                    amazonPayV2PaymentProcessor
                );

                await expect(strategy.initialize(initializeOptions)).rejects.toThrow(MissingDataError);
            });
        });
    });

    describe('#execute()', () => {
        let amazonpayv2InitializeOptions: AmazonPayV2PaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;
        let orderRequestBody: OrderRequestBody;
        const paymentToken = 'abc123';

        beforeEach(async () => {
            amazonpayv2InitializeOptions = { editButtonId: 'editButtonId' };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };
            orderRequestBody = {
                ...getOrderRequestBody(),
                payment: {
                    methodId: 'amazonpay',
                },
            };

            await strategy.initialize(initializeOptions);
        });

        it('executes the strategy successfully if paymentToken is found on intializationData', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                .mockReturnValue(paymentMethodMock);

            await strategy.execute(orderRequestBody, initializeOptions);

            expect(orderActionCreator.submitOrder).toHaveBeenCalledWith(orderRequestBody, initializeOptions);
            expect(paymentActionCreator.submitPayment).toHaveBeenCalledWith({ methodId: 'amazonpay', paymentData: { nonce: 'abc123' } });
        });

        it('executes the strategy successfully if it is a one-time transaction', async () => {
            const storeConfigMock = getConfig().storeConfig;
            storeConfigMock.checkoutSettings.features = {
                'PROJECT-3483.amazon_pay_ph4': true,
                'INT-6399.amazon_pay_apb': true,
            };
            jest.spyOn(store.getState().config, 'getStoreConfigOrThrow')
                .mockReturnValue(storeConfigMock);

            await strategy.execute(orderRequestBody, initializeOptions);

            expect(orderActionCreator.submitOrder).toHaveBeenCalledWith(orderRequestBody, initializeOptions);
            expect(paymentActionCreator.submitPayment).toHaveBeenCalledWith({ methodId: 'amazonpay', paymentData: { nonce: 'apb' } });
        });

        it('clicks sign-in button if no paymentToken is found on intializationData', async () => {
            const walletButton = document.getElementById('AmazonPayButton') as HTMLDivElement;
            jest.spyOn(walletButton, 'click');

            strategy.execute(orderRequestBody, initializeOptions);
            await new Promise(resolve => process.nextTick(resolve));

            expect(walletButton.click).toHaveBeenCalled();
        });

        it('redirects to Amazon url', async () => {
            paymentMethodMock.initializationData.paymentToken = paymentToken;
            jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                .mockReturnValue(paymentMethodMock);

            const paymentFailedErrorAction = of(createErrorAction(
                PaymentActionType.SubmitPaymentFailed,
                new RequestError(getResponse({
                    ...getErrorPaymentResponseBody(),
                    status: 'additional_action_required',
                    additional_action_required: {
                        data: {
                            redirect_url: 'http://some-url',
                        },
                    },
                }))
            ));
            jest.spyOn(paymentActionCreator, 'submitPayment')
                .mockReturnValue(paymentFailedErrorAction);

            window.location.assign = jest.fn();

            const walletButton = document.getElementById('AmazonPayButton') as HTMLDivElement;
            jest.spyOn(walletButton, 'click');

            strategy.execute(orderRequestBody, initializeOptions);
            await new Promise(resolve => process.nextTick(resolve));

            expect(window.location.assign).toBeCalledWith('http://some-url');
            expect(walletButton.click).not.toHaveBeenCalled();
        });

        it('should invoke Amazon Pay Pre-Order page', async () => {
            const storeConfigMock = getConfig().storeConfig;
            storeConfigMock.checkoutSettings.features = {
                'PROJECT-3483.amazon_pay_ph4': true,
                'INT-6399.amazon_pay_apb': true,
            };
            jest.spyOn(store.getState().config, 'getStoreConfigOrThrow')
                .mockReturnValue(storeConfigMock);

            const { publicKeyId, createCheckoutSessionConfig } = getAmazonPayV2Ph4ButtonParamsMock() as AmazonPayV2NewButtonParams;
            const expectedConfig = {
                publicKeyId,
                ...createCheckoutSessionConfig,
            };
            const paymentFailedErrorAction = of(createErrorAction(
                PaymentActionType.SubmitPaymentFailed,
                new RequestError(getResponse({
                    ...getErrorPaymentResponseBody(),
                    status: 'additional_action_required',
                    additional_action_required: {
                        data: {
                            redirect_url: JSON.stringify(expectedConfig),
                        },
                    },
                }))
            ));
            jest.spyOn(paymentActionCreator, 'submitPayment')
                .mockReturnValue(paymentFailedErrorAction);

            const walletButton = document.getElementById('AmazonPayButton') as HTMLDivElement;
            jest.spyOn(walletButton, 'click');

            strategy.execute(orderRequestBody, initializeOptions);
            await new Promise(resolve => process.nextTick(resolve));

            expect(amazonPayV2PaymentProcessor.prepareCheckout).toHaveBeenNthCalledWith(1, expectedConfig);
            expect(walletButton.click).toHaveBeenCalledTimes(1);
        });

        describe('should fail if...', () => {
            test('payment argument is invalid', async () => {
                orderRequestBody.payment = undefined;

                await expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(PaymentArgumentInvalidError);
            });

            test('payment method is not found', async () => {
                orderRequestBody.payment = { methodId: '' };

                await expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(MissingDataError);
            });

            test('strategy is not initialized', async () => {
                await strategy.deinitialize();

                await expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(NotInitializedError);
            });

            test('submitPayment throws an error different than additional_action_required', async () => {
                paymentMethodMock.initializationData.paymentToken = paymentToken;
                jest.spyOn(store.getState().paymentMethods, 'getPaymentMethodOrThrow')
                    .mockReturnValue(paymentMethodMock);

                const paymentFailedErrorAction = of(createErrorAction(
                    PaymentActionType.SubmitPaymentFailed,
                    new RequestError(getResponse(getErrorPaymentResponseBody()))
                ));
                jest.spyOn(paymentActionCreator, 'submitPayment')
                    .mockReturnValue(paymentFailedErrorAction);

                window.location.assign = jest.fn();

                await expect(strategy.execute(orderRequestBody, initializeOptions)).rejects.toThrow(RequestError);

                expect(window.location.assign).not.toHaveBeenCalled();
                expect(amazonPayV2PaymentProcessor.prepareCheckout).not.toHaveBeenCalled();
            });
        });
    });

    describe('#finalize()', () => {
        it('throws an error to inform that order finalization is not required', async () => {
            const promise = strategy.finalize();

            return expect(promise).rejects.toBeInstanceOf(OrderFinalizationNotRequiredError);
        });
    });

    describe('#deinitialize()', () => {
        let amazonpayv2InitializeOptions: AmazonPayV2PaymentInitializeOptions;
        let initializeOptions: PaymentInitializeOptions;

        beforeEach(async () => {
            amazonpayv2InitializeOptions = { editButtonId: 'editButtonId' };
            initializeOptions = { methodId: 'amazonpay', amazonpay: amazonpayv2InitializeOptions };
            await strategy.initialize(initializeOptions);
        });

        it('expect to deinitialize the payment processor', async () => {
            await strategy.deinitialize();

            expect(amazonPayV2PaymentProcessor.deinitialize).toHaveBeenCalled();
        });

        it('deinitializes strategy', async () => {
            expect(document.getElementById('AmazonPayButton')).not.toBeNull();
            await expect(strategy.deinitialize()).resolves.toEqual(store.getState());
            expect(document.getElementById('AmazonPayButton')).toBeNull();
        });
    });
});
