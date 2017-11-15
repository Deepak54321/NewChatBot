'use strict';
const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const app = express();
const uuid = require('uuid');
const pg=require('pg');
pg.defaults.ssl=true;


// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
    throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
    throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
    throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
    throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
    throw new Error('missing SERVER_URL');
}

if(!config.PG_CONFIG)
{
    throw new Error('missing PG_CONFIG');
}

app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
    verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
    extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
    language: "en",
    requestSource: "fb"
});
const sessionIds = new Map();

// Index route
app.get('/', function (req, res) {
    res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
    console.log("request");
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        console.error("Failed validation. Make sure the validation tokens match.");
        res.sendStatus(403);
    }
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
    var data = req.body;
    console.log(JSON.stringify(data));



    // Make sure this is a page subscription
    if (data.object == 'page') {
        // Iterate over each entry
        // There may be multiple if batched
        data.entry.forEach(function (pageEntry) {
            var pageID = pageEntry.id;
            var timeOfEvent = pageEntry.time;

            // Iterate over each messaging event
            pageEntry.messaging.forEach(function (messagingEvent) {
                if (messagingEvent.optin) {
                    receivedAuthentication(messagingEvent);
                } else if (messagingEvent.message) {
                    receivedMessage(messagingEvent);
                } else if (messagingEvent.delivery) {
                    receivedDeliveryConfirmation(messagingEvent);
                } else if (messagingEvent.postback) {
                    receivedPostback(messagingEvent);
                } else if (messagingEvent.read) {
                    receivedMessageRead(messagingEvent);
                } else if (messagingEvent.account_linking) {
                    receivedAccountLink(messagingEvent);
                } else {
                    console.log("Webhook received unknown messagingEvent: ", messagingEvent);
                }
            });
        });

        // Assume all went well.
        // You must send back a 200, within 20 seconds
        res.sendStatus(200);
    }
});





function receivedMessage(event) {

    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfMessage = event.timestamp;
    var message = event.message;

    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }
    //console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
    //console.log(JSON.stringify(message));

    var isEcho = message.is_echo;
    var messageId = message.mid;
    var appId = message.app_id;
    var metadata = message.metadata;

    // You may get a text or attachment but not both
    var messageText = message.text;
    var messageAttachments = message.attachments;
    var quickReply = message.quick_reply;

    if (isEcho) {
        handleEcho(messageId, appId, metadata);
        return;
    } else if (quickReply) {
        handleQuickReply(senderID, quickReply, messageId);
        return;
    }


    if (messageText) {
        //send message to api.ai
        sendToApiAi(senderID, messageText);
    } else if (messageAttachments) {
        handleMessageAttachments(messageAttachments, senderID);
    }
}


/*function handleMessageAttachments(messageAttachments, senderID){
    //for now just reply
    var text1=messageAttachments[0].payload.url;
    //If no URL, then it is a location
    if(text1 == undefined || text1 == "")
    {
        text1 =  "latitude:"
            +messageAttachments[0].payload.coordinates.lat
            +",longitude:"
            +messageAttachments[0].payload.coordinates.long;
                let replies =  [
            {
                "content_type":"text",
                "title":"GetPrice",
                "payload":text1
            }];
        contexts[0].parameters['lattitude'] =messageAttachments[0].payload.coordinates.lat;
        contexts[0].parameters['longitude'] =messageAttachments[0].payload.coordinates.long;
        sendQuickReply(senderID,text1,replies);
        //sendTextMessage(senderID, "Attachment received. Thank you."+text+"fsdf");
    }
}*/

function handleQuickReply(senderID, quickReply, messageId) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
    //send payload to api.ai
    sendToApiAi(senderID, quickReplyPayload);
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
    // Just logging message echoes to console
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
    switch (action) {
        case "user-feedback":
            let replies =  [
                {
                    "content_type":"text",
                    "title":"Excellent",
                    "image_url":"https://ih1.redbubble.net/image.237042550.9854/sticker,375x360-bg,ffffff.u4.png",
                    "payload":"Excellent"
                },
                {
                    "content_type":"text",
                    "title":"Good",
                    "image_url":"https://previews.123rf.com/images/fotoall/fotoall0907/fotoall090700085/5270227-Smiley-face-isolated-on-white-background-Stock-Photo-happy.jpg",
                    "payload":"Good"
                },
                {
                    "content_type":"text",
                    "title":"Average",
                    "image_url":"https://previews.123rf.com/images/vectorshots/vectorshots1211/vectorshots121100267/16104680-Smile-Icon-Vector-Stock-Vector-smiley-face-smile.jpg",
                    "payload":"Average"
                },
                {
                    "content_type":"text",
                    "title":"Bad",
                    "image_url":"https://st3.depositphotos.com/1954927/15979/v/1600/depositphotos_159794904-stock-illustration-smileyemoticon-yellow-face-with-emotions.jpg",
                    "payload":"Bad"

                }
            ];
            sendQuickReply(sender, responseText, replies);
            break;
        case "job-enquiry":
            let reply =  [
                {
                    "content_type":"text",
                    "title":"Accountant",
                    "payload":"Accountant"
                },
                {
                    "content_type":"text",
                    "title":"Sales",
                    "payload":"Sales"
                },
                {
                    "content_type":"text",
                    "title":"Bookkeeper",
                    "payload":"Book Keeper"
                }
            ];
            sendQuickReply(sender, responseText, reply);
            break;
        case "user-data":
            if(isDefined(contexts[0]) && contexts[0].name=='welcomeyamaha' && contexts[0].parameters) {
                let rply =  [
                    {
                        "content_type":"text",
                        "title":"Restart",
                        "payload":"Restart"
                    }
                ];
                let phone_number = (isDefined(contexts[0].parameters['ProductPhoneNumber']) &&
                    contexts[0].parameters['ProductPhoneNumber'] != '') ? contexts[0].parameters['ProductPhoneNumber'] : '';
                let email = (isDefined(contexts[0].parameters['ProductEnquiryEmail']) &&
                    contexts[0].parameters['ProductEnquiryEmail'] != '') ? contexts[0].parameters['ProductEnquiryEmail'] : '';
                let product_customer_interest = (isDefined(contexts[0].parameters['ProductCustomerInterest']) &&
                    contexts[0].parameters['ProductCustomerInterest'] != '') ? contexts[0].parameters['ProductCustomerInterest'] : '';
                let Product_Enquiry_Feedback = (isDefined(contexts[0].parameters['ProductEnquiryFeedback']) &&
                    contexts[0].parameters['ProductEnquiryFeedback'] != '') ? contexts[0].parameters['ProductEnquiryFeedback'] : '';
                let lattitude=(isDefined(contexts[0].parameters['pincode']) &&
                    contexts[0].parameters['pincode'] != '') ? contexts[0].parameters['pincode'] : '';
                if (phone_number != '' && email != '') {
                    let emailContent =  'Phone Number:=' + phone_number + 'email:=' + email + 'customer' +
                        'Customer Interest' + product_customer_interest + 'Product_Feedback '+ Product_Enquiry_Feedback +'Pin Code'+lattitude+'';
                    // sendTextMessage(sender, emailContent);
                    sendQuickReply(sender,emailContent,rply);
                    //responseText=emailContent;
                }
                sendQuickReply(sender,responseText,rply);
            }
            break;
        case "testuser-data":
            let testrply =  [
                {
                    "content_type":"text",
                    "title":"Restart",
                    "payload":"Restart"
                }
            ];
            if(isDefined(contexts[0]) && contexts[0].name=='welcomeyamaha' && contexts[0].parameters) {
                let phone_number = (isDefined(contexts[0].parameters['testphonenumber']) &&
                    contexts[0].parameters['testphonenumber'] != '') ? contexts[0].parameters['testphonenumber'] : '';
                let email = (isDefined(contexts[0].parameters['TestEmail']) &&
                    contexts[0].parameters['TestEmail'] != '') ? contexts[0].parameters['TestEmail'] : '';
                let testdrive_customer_interest = (isDefined(contexts[0].parameters['TestRideCustomerInterest']) &&
                    contexts[0].parameters['TestRideCustomerInterest'] != '') ? contexts[0].parameters['TestRideCustomerInterest'] : '';
                let testride_Feedback = (isDefined(contexts[0].parameters['TestRideFeedback']) &&
                    contexts[0].parameters['TestRideFeedback'] != '') ? contexts[0].parameters['TestRideFeedback'] : '';
                let pincode=(isDefined(contexts[0].parameters['TestPincode']) &&
                    contexts[0].parameters['TestPincode'] != '') ? contexts[0].parameters['TestPincode'] : '';

                if (phone_number != '' && email != '') {
                    let emailContent =  'Phone Number:=' + phone_number + 'email:=' + email + 'customer' +
                        'Customer Interest' + testdrive_customer_interest + 'TestRide Feedback'+ testride_Feedback +'Pincode'+pincode+'';
                    sendQuickReply(sender,emailContent,testrply);
                    //responseText=emailContent;
                }
                sendTextMessage(sender, responseText);
            }
            break;
        case "complaintuser-data":
            let comrply =  [
                {
                    "content_type":"text",
                    "title":"Restart",
                    "payload":"Restart"
                }
            ];
            if(isDefined(contexts[0]) && contexts[0].name=='welcomeyamaha' && contexts[0].parameters) {
                let phone_number = (isDefined(contexts[0].parameters['complaintphonenumber']) &&
                    contexts[0].parameters['complaintphonenumber'] != '') ? contexts[0].parameters['complaintphonenumber'] : '';
                let email = (isDefined(contexts[0].parameters['ComplaintEmail']) &&
                    contexts[0].parameters['ComplaintEmail'] != '') ? contexts[0].parameters['ComplaintEmail'] : '';
                let Complaint_ChasisNo = (isDefined(contexts[0].parameters['ComplaintChasisNo']) &&
                    contexts[0].parameters['ComplaintChasisNo'] != '') ? contexts[0].parameters['ComplaintChasisNo'] : '';
                let ComplaintFeedback = (isDefined(contexts[0].parameters['ComplaintFeedback']) &&
                    contexts[0].parameters['ComplaintFeedback'] != '') ? contexts[0].parameters['ComplaintFeedback'] : '';
                let Complaint_Model_Name=(isDefined(contexts[0].parameters['ComplaintModelName']) &&
                    contexts[0].parameters['ComplaintModelName'] != '') ? contexts[0].parameters['ComplaintModelName'] : '';

                if (phone_number != '' && email != '') {
                    let emailContent =  'Phone Number:=' + phone_number + 'email:=' + email + 'customer' +
                        'Complaint Chasis No' + Complaint_ChasisNo + 'Complaint Feedback'+ ComplaintFeedback +'Complaint Model'+Complaint_Model_Name+'';
                    sendQuickReply(sender,emailContent,comrply);
                    //responseText=emailContent;
                }
                sendTextMessage(sender, responseText);
            }
            break;
        case "dealer-price":
            var request = require('request');
            request({
                url:'http://www.yamaha-motor-india.com/iym-web-api//51DCDFC2A2BC9/statewiseprice/getprice?product_profile_id=salutorxspcol&state_id=240'
            },function (error,response,body) {
                if (!error && response.statusCode == 200) {
                    let result = JSON.parse(body);
                    let responseCode=result.responseData;
                    let productPrice=responseCode.product_price;
                    let price=productPrice[0].price +'Rs';
                    {
                        let reply =  [
                            {
                                "content_type":"text",
                                "title":"Feedback",
                                "payload":"Feedback"
                            }
                        ];
                        sendQuickReply(sender,price,reply);
                        //greetUserText(sender.id);
                    }
                }
                else {
                    console(log.error());
                }
            });
            break;
        case "dealer-info":
            // let dealer_pin= contexts[0].parameters['pincode'];
            let dealer_pin=(isDefined(contexts[0].parameters['pincode'])&&
                contexts[0].parameters['pincode']!='')? contexts[0].parameters['pincode']:'';
            //var pincode=110005;

            var StateId='';
            var CityId='';
            var City='';
            var State='';
            var Country='';
            var lat='';
            var lng='';
            var State_Name='';
            var City_Name='';
            var address='';
            var stateF='';
            var dealerId='';
            var address_components='';
            var message='';

            var request = require('request');
            //1
            request({
                url:'https://maps.googleapis.com/maps/api/geocode/json?address='+dealer_pin+'&key=AIzaSyD_YqB4d_-xKcmNP9jJCiPkJYDS8J3f6pI'
            },function (error,response,body) {
                if (!error && response.statusCode == 200) {
                    let result = JSON.parse(body);
                    let Results = result.results;
                    for (var i = 0; i < Results.length; i++)
                    {
                        address = Results[i].formatted_address;
                        address_components = Results[i].address_components;
                        var len = address_components.length;
                        var gemotry = Results[i].geometry;
                        var location = gemotry.location;
                        lat = location.lat;
                        lng = location.lng;
                        for (var j = 0; j < address_components.length; j++) {
                            if (j == len - 3) {
                                City = address_components[j].long_name;
                            }
                            else if (j == len - 2) {
                                State = address_components[j].long_name;
                            }
                            else if (j == len - 1) {
                                Country = address_components[j].long_name;
                            }
                        }
                    }

                    //console.log(city);
                    let view = State + City + Country + 'Hi now you can get your dealers' + lat + lng;
                    //2
                    request({
                        url: 'http://www.yamaha-motor-india.com/iym-web-api//51DCDFC2A2BC9/network/state'
                    }, function (error, response, body) {
                        if (!error && response.statusCode == 200) {
                            var res = JSON.parse(body);
                            var responseData = res.responseData;
                            var states = responseData.states;

                            for (var i = 0; i < states.length; i++) {
                                if (states[i].state_name === State) {
                                    StateId = states[i].profile_id;
                                    State_Name = states[i].state_name;

                                }

                            }
                            let reply2 = [
                                {
                                    "content_type": "text",
                                    "title": "Restart",
                                    "payload": "Restart"
                                }
                            ];
                            if(StateId=='') {
                                sendQuickReply(sender,"No dealers Found in your area Please restart your conversation", reply2);
                            }

                            //sendTextMessage(sender,StateId);
                            //3
                            request({
                                url: 'http://www.yamaha-motor-india.com/iym-web-api//51DCDFC2A2BC9/network/city?profile_id=' + StateId
                            }, function (error, response, body) {
                                if (!error && response.statusCode == 200) {
                                    var result = JSON.parse(body);
                                    var responsData = result.responseData;
                                    var citites = responsData.cities;
                                    for (var i = 0; i < citites.length; i++) {

                                        if (citites[i].city_name == City) {
                                            CityId = citites[i].city_profile_id;
                                        }
                                    }
                                    let reply3 = [
                                        {
                                            "content_type": "text",
                                            "title": "Restart",
                                            "payload": "Restart"
                                        }
                                    ];
                                    if(CityId=='') {
                                        sendQuickReply(sender,"No dealers Found in your area Please restart your conversation", reply3);
                                    }

                                    //var message=StateId+CityId;
                                    //sendTextMessage(sender,message);

                                    request({
                                        url: 'http://www.yamaha-motor-india.com/iym-web-api//51DCDFC2A2BC9/network/search?type=sales&profile_id=' + StateId + '&city_profile_id=' + CityId
                                    }, function (error, response, body) {
                                        if (!error && response.statusCode == 200) {
                                            var result = JSON.parse(body);
                                            var resData = result.responseData;
                                            var dealers = resData.dealers;
                                            dealerId=dealers[0].dealer_name;
                                            var dealer_name = dealers[0].dealer_name;
                                            var dealer_add = dealers[0].dealer_address;
                                            var dealer_Mob = dealers[0].sales_manager_mobile;
                                            var text1 = dealer_name + dealer_add + dealer_Mob;
                                            let rply = [
                                                {
                                                    "content_type": "text",
                                                    "title": "Feedback",
                                                    "payload": "Feedback"
                                                }
                                            ];
                                            if(text1!='') {
                                                sendQuickReply(sender, text1, rply);
                                            }
                                            else
                                            {
                                                sendQuickReply(sender,"No dealers Found in your area", rply);
                                            }
                                            //sendTextMessage(sender,text1);
                                        }
                                        else {
                                            console(log.error());
                                        }
                                    });
                                    /* if(StateId==''|| CityId=='' || dealerId=='')
                                     {
                                         let reply = [
                                             {
                                                 "content_type": "text",
                                                 "title": "Feedback",
                                                 "payload": "Feedback"
                                             }
                                         ];
                                         sendQuickReply(sender,"No Dealers found in you area ....", rply);
                                     }*/

                                }
                                else {
                                    console(log.error());
                                }
                            });
                        }
                        else {
                            console(log.error());
                        }
                    });

                }
                else {
                    console(log.error());

                }

            });


            break;
        case "user":
            sendTextMessage(sender,"Your Id"+sender.id+"");
            break;
        default:
            //unhandled action, just send back the text
            sendTextMessage(sender, responseText);
    }
}

function handleMessage(message, sender) {
    switch (message.type) {
        case 0: //text
            sendTextMessage(sender, message.speech);
            break;
        case 2: //quick replies
            let replies = [];
            for (var b = 0; b < message.replies.length; b++) {
                let reply =
                    {
                        "content_type": "text",
                        "title": message.replies[b],
                        "payload": message.replies[b]
                    }
                replies.push(reply);
            }
            sendQuickReply(sender, message.title, replies);
            break;
        case 3: //image
            sendImageMessage(sender, message.imageUrl);
            break;
        case 4:
            // custom payload
            var messageData = {
                recipient: {
                    id: sender
                },
                message: message.payload.facebook

            };

            callSendAPI(messageData);

            break;
    }
}


function handleCardMessages(messages, sender) {

    let elements = [];
    for (var m = 0; m < messages.length; m++) {
        let message = messages[m];
        let buttons = [];
        for (var b = 0; b < message.buttons.length; b++) {
            let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
            let button;
            if (isLink) {
                button = {
                    "type": "web_url",
                    "title": message.buttons[b].text,
                    "url": message.buttons[b].postback
                }
            } else {
                button = {
                    "type": "postback",
                    "title": message.buttons[b].text,
                    "payload": message.buttons[b].postback
                }
            }
            buttons.push(button);
        }


        let element = {
            "title": message.title,
            "image_url":message.imageUrl,
            "subtitle": message.subtitle,
            "buttons": buttons
        };
        elements.push(element);
    }
    sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
    let responseText = response.result.fulfillment.speech;
    let responseData = response.result.fulfillment.data;
    let messages = response.result.fulfillment.messages;
    let action = response.result.action;
    let contexts = response.result.contexts;
    let parameters = response.result.parameters;

    sendTypingOff(sender);

    if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
        let timeoutInterval = 1100;
        let previousType ;
        let cardTypes = [];
        let timeout = 0;
        for (var i = 0; i < messages.length; i++) {

            if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

                timeout = (i - 1) * timeoutInterval;
                setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
                timeout = i * timeoutInterval;
                setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
            } else if ( messages[i].type == 1 && i == messages.length - 1) {
                cardTypes.push(messages[i]);
                timeout = (i - 1) * timeoutInterval;
                setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                cardTypes = [];
            } else if ( messages[i].type == 1 ) {
                cardTypes.push(messages[i]);
            } else {
                timeout = i * timeoutInterval;
                setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
            }

            previousType = messages[i].type;

        }
    } else if (responseText == '' && !isDefined(action)) {
        //api ai could not evaluate input.
        console.log('Unknown query' + response.result.resolvedQuery);
        sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
    } else if (isDefined(action)) {
        handleApiAiAction(sender, action, responseText, contexts, parameters);
    } else if (isDefined(responseData) && isDefined(responseData.facebook)) {
        try {
            console.log('Response as formatted message' + responseData.facebook);
            sendTextMessage(sender, responseData.facebook);
        } catch (err) {
            sendTextMessage(sender, err.message);
        }
    } else if (isDefined(responseText)) {

        sendTextMessage(sender, responseText);
    }
}

function sendToApiAi(sender, text) {

    sendTypingOn(sender);
    let apiaiRequest = apiAiService.textRequest(text, {
        sessionId: sessionIds.get(sender)
    });

    apiaiRequest.on('response', (response) => {
        if (isDefined(response.result)) {
        handleApiAiResponse(sender, response);
    }
});

    apiaiRequest.on('error', (error) => console.error(error));
    apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text
        }
    }
    callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: imageUrl
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "image",
                payload: {
                    url: config.SERVER_URL + "/assets/instagram_logo.gif"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "audio",
                payload: {
                    url: config.SERVER_URL + "/assets/sample.mp3"
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: config.SERVER_URL + videoName
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "file",
                payload: {
                    url: config.SERVER_URL + fileName
                }
            }
        }
    };

    callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: text,
                    buttons: buttons
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "generic",
                    elements: elements
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
                            timestamp, elements, address, summary, adjustments) {
    // Generate a random receipt ID as the API requires a unique ID
    var receiptId = "order" + Math.floor(Math.random() * 1000);

    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name: recipient_name,
                    order_number: receiptId,
                    currency: currency,
                    payment_method: payment_method,
                    timestamp: timestamp,
                    elements: elements,
                    address: address,
                    summary: summary,
                    adjustments: adjustments
                }
            }
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            text: text,
            metadata: isDefined(metadata)?metadata:'',
            quick_replies: replies
        }
    };

    callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "mark_seen"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_on"
    };

    callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


    var messageData = {
        recipient: {
            id: recipientId
        },
        sender_action: "typing_off"
    };

    callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
    var messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "Welcome. Link your account.",
                    buttons: [{
                        type: "account_link",
                        url: config.SERVER_URL + "/authorize"
                    }]
                }
            }
        }
    };

    callSendAPI(messageData);
}


function greetUserText(userId) {

    //first read user firstname
    request({
        uri: 'https://graph.facebook.com/v2.7/' + userId,
        qs: {
            access_token: config.FB_PAGE_TOKEN
        }

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {

            var user = JSON.parse(body);

            if (user.first_name) {
                console.log("FB user: %s %s, %s",
                    user.first_name, user.last_name, user.gender);
                console.log("UserId is %s",userId);
                var connectionString = "postgres://hplemmqnodrktw:46fecc18d4edb226ae70341dddb67303f980b4992be13d1512b967e9d1c26656@ec2-54-243-252-232.compute-1.amazonaws.com:5432/d1d9dpk0dupij6";
                var pgClient = new pg.Client(connectionString);
                pgClient.connect();
                const query = pgClient.query("SELECT id from users LIMIT 1",
                function(err, result){
                   console.log('Record is : %s'+result);
                   if(err)
                   {
                       console.log("Derror occedde"+err);
                   }
                });
                query.on("row", function(row,result){
                    console.log("Apex Row is "+row);
                    console.log("Apex Column is"+result);
                    //result.addRow(row);

                });
               /*
                var pool = new pg.Pool(config.PG_CONFIG);
                pool.connect(function(err, client, done) {
                    if (err) {
                        return console.error('Error acquiring client', err.stack);
                    }
                    var rows = [];
                    client.
                    client.query("SELECT * FROM users",
                        function(err, result) {
                            console.log('query result ' + result);
                            console.log("Test");
                            if(err)
                            {
                                console.log("Error occurred");
                            }
                            else
                            {
                                console.log("Run success");
                            }
                            if (err) {
                                console.log('Query error: ' + err);
                            } else {
                                console.log('rows: ' + result.rows.length);
                                if (result.rows.length === 0) {
                                    let sql = 'INSERT INTO users (fb_id, first_name, last_name, profile_pic,locale, timezone, gender) VALUES ($1, $2, $3, $4, $5, $6, $7)';
                                    console.log('sql: ' + sql);
                                    client.query(sql,
                                        [
                                            userId,
                                            user.first_name,
                                            user.last_name,
                                            user.profile_pic,
                                            user.locale,
                                            user.timezone,
                                            user.gender
                                        ]);
                                }
                            }
                        });
                     done();
                });
                pool.end();
                */
                //contexts[0].parameters['UserName'] = user.first_name;
                let message=user.first_name +" I am your Bot your Bot Please Choose One of the following options";
                let reply =  [
                    {
                        "content_type":"text",
                        "title":"Product Enquiry",
                        "payload":"Product Enquiry"
                    },
                    {
                        "content_type":"text",
                        "title":"Test Drive",
                        "payload":"Test Drive"
                    },
                    {
                        "content_type":"text",
                        "title":"Complaint",
                        "payload":"Complaint"
                    }
                ];
                sendQuickReply(userId,message,reply);
                //sendTextMessage(userId, "Welcome " + user.first_name + '!');
               // sendQuickReply()
            } else {
                console.log("Cannot get data for fb user with id",
                    userId);
            }
        } else {
            console.error(response.error);
        }

    });
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
    request({
        uri: 'https://graph.facebook.com/v2.6/me/messages',
        qs: {
            access_token: config.FB_PAGE_TOKEN
        },
        method: 'POST',
        json: messageData

    }, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var recipientId = body.recipient_id;
            var messageId = body.message_id;

            if (messageId) {
                console.log("Successfully sent message with id %s to recipient %s",
                    messageId, recipientId);
            } else {
                console.log("Successfully called Send API for recipient %s",
                    recipientId);
            }
        } else {
            console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
        }
    });
}



/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfPostback = event.timestamp;

    // The 'payload' param is a developer-defined field which is set in a postback
    // button for Structured Messages.
    var payload = event.postback.payload;

    switch (payload) {
        case "GET_STARTED":
            greetUserText(senderID);
            break;
        default:
            //unindentified payload
            sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");
            break;

    }

    console.log("Received postback for user %d and page %d with payload '%s' " +
        "at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    // All messages before watermark (a timestamp) or sequence have been seen.
    var watermark = event.read.watermark;
    var sequenceNumber = event.read.seq;

    console.log("Received message read event for watermark %d and sequence " +
        "number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;

    var status = event.account_linking.status;
    var authCode = event.account_linking.authorization_code;

    console.log("Received account link event with for user %d with status %s " +
        "and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var delivery = event.delivery;
    var messageIDs = delivery.mids;
    var watermark = delivery.watermark;
    var sequenceNumber = delivery.seq;

    if (messageIDs) {
        messageIDs.forEach(function (messageID) {
            console.log("Received delivery confirmation for message ID: %s",
                messageID);
        });
    }

    console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
    var senderID = event.sender.id;
    var recipientID = event.recipient.id;
    var timeOfAuth = event.timestamp;

    // The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
    // The developer can set this to an arbitrary value to associate the
    // authentication callback with the 'Send to Messenger' click event. This is
    // a way to do account linking when the user clicks the 'Send to Messenger'
    // plugin.
    var passThroughParam = event.optin.ref;

    console.log("Received authentication for user %d and page %d with pass " +
        "through param '%s' at %d", senderID, recipientID, passThroughParam,
        timeOfAuth);

    // When an authentication is received, we'll send a message back to the sender
    // to let them know it was successful.
    sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
    var signature = req.headers["x-hub-signature"];

    if (!signature) {
        throw new Error('Couldn\'t validate the signature.');
    } else {
        var elements = signature.split('=');
        var method = elements[0];
        var signatureHash = elements[1];

        var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
            .update(buf)
            .digest('hex');

        if (signatureHash != expectedHash) {
            throw new Error("Couldn't validate the request signature.");
        }
    }
}

function isDefined(obj) {
    if (typeof obj == 'undefined') {
        return false;
    }

    if (!obj) {
        return false;
    }

    return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
    console.log('running on port', app.get('port'))
})
