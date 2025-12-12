<?php
$key = 'sk_test_ZUQZTcYD1aKHEswmy27iuz4p00w4dSIWFq';  //replace with your key

$json = file_get_contents('php://input');
$action = json_decode($json, true);

if (isset($action) && $action['amount'] !== 0 && $action['currency'] !== '') {
    $amount = $action['amount'];
    $currency = $action['currency'];

    $curl = curl_init();

    curl_setopt_array($curl, array(
        CURLOPT_URL => 'https://api.stripe.com/v1/payment_intents',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_ENCODING => '',
        CURLOPT_MAXREDIRS => 10,
        CURLOPT_TIMEOUT => 0,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_CUSTOMREQUEST => 'POST',
        CURLOPT_POSTFIELDS => 'amount='.$amount.'&currency='.$currency.'&automatic_payment_methods[enabled]=false&payment_method_types[0]=card',
        CURLOPT_HTTPHEADER => array(
        'Content-Type: application/x-www-form-urlencoded',
        'Authorization: Bearer '.$key
        ),
    ));
        
    $response = curl_exec($curl);
        
    curl_close($curl);
    $intentresponse = json_decode($response);
        
    echo json_encode(['clientSecret' => $intentresponse->client_secret]);
}
?>