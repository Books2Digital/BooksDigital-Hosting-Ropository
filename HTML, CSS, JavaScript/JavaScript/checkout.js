const stripe = Stripe('your-publishable-key');
const elements = stripe.elements();
const card = elements.create('card');
card.mount('#card-element');

const form = document.getElementById('payment-form');
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const amount = 2000; // Amount in cents
  const currency = 'usd';

  const response = await fetch('/create-payment-intent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount, currency }),
  });

  const { clientSecret } = await response.json();

  const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
    payment_method: {
      card: card,
      billing_details: {
        name: 'Customer Name',
        email: 'customer@example.com',
      },
    },
  });

  if (error) {
    console.error('Payment failed:', error.message);
  } else if (paymentIntent.status === 'succeeded') {
    window.location.href = '/success.html';
  }
});
