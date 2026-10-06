function translate_activity_type(activity_type) {
    map = {
        'science' : 'tudomány', 
        'exploration': 'kutatás', 
        'map': 'térkép', 
        'merge':'összekötés',
        'extend': 'feltárás', 
        'protected': 'védelem', 
        'hidrology': 'hidrológia', 
        'fauna': 'fauna', 
        'entrance': 'táróhajtás', 
        'death': 'haláleset', 
        'rescue': 'mentés', 
        'diving': 'búvárkodás', 
        'info': 'info', 
        'climbing': 'mászás', 
        'digging': 'bontás', 
        'sifon': 'szifon', 
        'paleo': 'régészet/őslénytan',
        'enter': 'bejutás', 
        'reference': 'említés', 
        'discover': 'megtalálás', 
        'healing': 'gyógy', 
        'closed': 'lezárás', 
        'visit': 'bejárás', 
        'tourist': 'turisztika'    
    }

    if (map[activity_type] != '') {
        return map[activity_type];
    } else {
        return "más";
    }
}

function translate_activity_types(activity_types) {
    var translated  = []
    for (var i in activity_types) {
        translated.push(translate_activity_type(activity_types[i]));
    }
    return translated;
}


function setCookie(cname,cvalue,exdays) {
    var d = new Date();
    d.setTime(d.getTime() + (exdays*24*60*60*1000));
    var expires = "expires=" + d.toGMTString();
    document.cookie = cname+"="+cvalue+"; "+expires;
}

function getCookie(cname) {
    var name = cname + "=";
    var ca = document.cookie.split(';');
    for(var i=0; i<ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1);
        if (c.indexOf(name) != -1) {
            return c.substring(name.length, c.length);
        }
    }
    return "";
}

function checkCookie(key) {
    var value=getCookie(key);
    if (value != "") {
        return true;
    }
}
