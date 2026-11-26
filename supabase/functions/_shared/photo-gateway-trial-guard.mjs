/**
 * Trial-only deny-by-default guard. Production authorization is NOT supplied here.
 * Allow only three explicitly approved synthetic Auth UUIDs and the one QA item.
 * No Origin header is trusted as identity. Server env, verified claims and
 * live-user data must all agree. Fixed synthetic object UUID + upsert:false
 * bounds repeated uploads to one path per test household.
 */
export const QA_COHORT='f8a63d1e92';
export const QA_RECORD='qa_'+QA_COHORT+'_item';
export const QA_FILE='5ca20f26-739f-4c19-8a75-56e09319af82';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isUUID=v=>typeof v==='string'&&v.length===36&&UUID.test(v);
export function trialConfig(enabled,raw){
 if(enabled!=='true'||typeof raw!=='string')return null;
 const ids=raw.split(',').map(x=>x.trim());
 if(ids.length!==3||!ids.every(isUUID)||new Set(ids).size!==3)return null;
 return Object.freeze({a:ids[0],b:ids[1],c:ids[2]});
}
export function approvedTrialUser(config,user,claims){
 if(!config||!user||!claims||!isUUID(user.id)||claims.sub!==user.id||
    !isUUID(claims.session_id)||user.is_anonymous!==false||
    typeof user.email_confirmed_at!=='string'||!user.email_confirmed_at)return null;
 const role=['a','b','c'].find(r=>config[r]===user.id);
 if(!role||user.email!=='atokore-qa-'+role+'-'+QA_COHORT+'@example.invalid')return null;
 return Object.freeze({id:user.id,role,sessionId:claims.session_id});
}
export function approvedTrialRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return false;
 if(input.operation==='write')return isUUID(input.householdId)&&input.recordId===QA_RECORD;
 if(!['read','delete'].includes(input.operation)||typeof input.path!=='string')return false;
 const parts=input.path.split('/');
 return parts.length===3&&isUUID(parts[0])&&parts[1]===QA_RECORD&&parts[2]===QA_FILE+'.jpg';
}
