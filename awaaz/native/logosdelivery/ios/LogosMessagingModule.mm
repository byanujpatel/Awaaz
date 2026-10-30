// LogosMessaging — iOS port of the Android JNI module (com.receiverandroid).
// Embeds the liblogosdelivery (Nim) node as a static library and exposes the
// SAME JS API + "logosMessage" event, so src/lib/delivery-native.ts works on
// both platforms unchanged.
//
// FFI semantics: request callbacks may fire EITHER synchronously (before the
// C function returns) OR later from the node's FFI worker thread. The JNI
// bridge captures results in stack variables and wins that race on Android;
// on iOS it reliably loses it (SIGSEGV in the callback on a dead frame). So
// here every request carries a heap-retained completion object and the RN
// promise is settled from whichever side reports first.

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#include <stdlib.h>
#include <string.h>

#include "liblogosdelivery.h"
#include "liblogosdelivery_kernel.h"

// ---------------------------------------------------------------------------

@interface LMCompletion : NSObject
@property (nonatomic, copy) void (^fn)(int ret, NSString *_Nullable msg);
- (void)settle:(int)ret msg:(NSString *_Nullable)msg;
@end

@implementation LMCompletion {
  BOOL _settled;
}
- (void)settle:(int)ret msg:(NSString *)msg {
  @synchronized(self) {
    if (_settled) return;
    _settled = YES;
  }
  if (self.fn) self.fn(ret, msg);
}
@end

// In-flight registry: keeps completion objects alive until settled, since the
// callback may arrive from a foreign thread after the calling frame is gone.
static NSMutableSet<LMCompletion *> *gInFlight;
static dispatch_queue_t gInFlightQueue;

static void *lm_retain_completion(LMCompletion *c) {
  dispatch_sync(gInFlightQueue, ^{ [gInFlight addObject:c]; });
  return (__bridge void *)c;
}

static void lm_request_cb(int ret, const char *msg, size_t len, void *user_data) {
  LMCompletion *c = (__bridge LMCompletion *)user_data;
  if (c == nil) return;
  NSString *s = nil;
  if (msg != NULL && len > 0) {
    s = [[NSString alloc] initWithBytes:msg length:len encoding:NSUTF8StringEncoding];
  }
  [c settle:ret msg:s];
  dispatch_async(gInFlightQueue, ^{ [gInFlight removeObject:c]; });
}

// ---------------------------------------------------------------------------

@interface LogosMessaging : RCTEventEmitter <RCTBridgeModule>
@end

static LogosMessaging *gEmitter = nil;
static BOOL gHasListeners = NO;

// Event callback — invoked from the node's worker threads. Forwards the raw
// event JSON plus the node pointer, like EventCallbackManager on Android.
static void lm_event_callback(int callerRet, const char *msg, size_t len, void *userData) {
  (void)callerRet;
  if (msg == NULL || len == 0) return; // empty-event guard (nim-ffi#139)
  LogosMessaging *emitter = gEmitter;
  if (emitter == nil || !gHasListeners) return;
  NSString *event = [[NSString alloc] initWithBytes:msg length:len encoding:NSUTF8StringEncoding];
  if (event == nil) return;
  NSString *ptrStr = [NSString stringWithFormat:@"%lld", (long long)(intptr_t)userData];
  [emitter sendEventWithName:@"logosMessage" body:@{ @"wakuPtr" : ptrStr, @"event" : event }];
}

@implementation LogosMessaging

RCT_EXPORT_MODULE(LogosMessaging);

- (instancetype)init {
  if (self = [super init]) {
    gEmitter = self;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      gInFlight = [NSMutableSet new];
      gInFlightQueue = dispatch_queue_create("com.cockroach.logosmessaging.inflight", DISPATCH_QUEUE_SERIAL);
    });
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

// Serialize all node calls off the JS thread; start_node can take seconds.
- (dispatch_queue_t)methodQueue {
  return dispatch_queue_create("com.cockroach.logosmessaging", DISPATCH_QUEUE_SERIAL);
}

- (NSArray<NSString *> *)supportedEvents {
  return @[ @"logosMessage" ];
}

- (void)startObserving {
  gHasListeners = YES;
}

- (void)stopObserving {
  gHasListeners = NO;
}

static void *lm_ptr(NSString *ctx) {
  return (void *)(intptr_t)strtoll([ctx UTF8String], NULL, 10);
}

static LMCompletion *lm_promise_completion(NSString *tag,
                                           RCTPromiseResolveBlock resolve,
                                           RCTPromiseRejectBlock reject) {
  LMCompletion *c = [LMCompletion new];
  c.fn = ^(int ret, NSString *msg) {
    if (ret == RET_OK) {
      resolve(msg ?: @"ok");
    } else {
      reject(tag, msg ?: [NSString stringWithFormat:@"%@ failed (code %d)", tag, ret], nil);
    }
  };
  return c;
}

RCT_EXPORT_METHOD(setup : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  // Static library — nothing to dlopen; node logs go to process stdout.
  resolve(nil);
}

RCT_EXPORT_METHOD(new : (NSDictionary *)config resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  NSError *err = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:config options:0 error:&err];
  if (json == nil) {
    reject(@"waku_new", @"config not serializable", err);
    return;
  }
  NSString *configStr = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];

  // The node pointer comes from the function return, not the callback — the
  // completion only tracks an error message for the reject path.
  __block NSString *cbError = nil;
  LMCompletion *c = [LMCompletion new];
  c.fn = ^(int ret, NSString *msg) {
    if (ret != RET_OK) cbError = msg ?: @"create_node callback error";
  };
  void *ptr = logosdelivery_create_node([configStr UTF8String], lm_request_cb, lm_retain_completion(c));
  if (ptr == NULL) {
    reject(@"waku_new", cbError ?: @"node creation returned null (config rejected)", nil);
    return;
  }
  logosdelivery_set_event_callback(ptr, lm_event_callback, ptr);
  resolve([NSString stringWithFormat:@"%lld", (long long)(intptr_t)ptr]);
}

#define LM_PROMISE_CALL(FN, TAG)                                                   \
  LMCompletion *c = lm_promise_completion(@TAG, resolve, reject);                  \
  int rc = FN(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c));                \
  if (rc != RET_OK) [c settle:rc msg:@TAG " returned error status"];

RCT_EXPORT_METHOD(start : (NSString *)ctx resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LM_PROMISE_CALL(logosdelivery_start_node, "waku_start")
}

RCT_EXPORT_METHOD(stop : (NSString *)ctx resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LM_PROMISE_CALL(logosdelivery_stop_node, "waku_stop")
}

RCT_EXPORT_METHOD(destroy : (NSString *)ctx resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LM_PROMISE_CALL(logosdelivery_destroy, "waku_destroy")
}

RCT_EXPORT_METHOD(version : (NSString *)ctx resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LM_PROMISE_CALL(waku_version, "waku_version")
}

RCT_EXPORT_METHOD(listenAddresses : (NSString *)ctx resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LM_PROMISE_CALL(waku_listen_addresses, "waku_listen_addresses")
}

RCT_EXPORT_METHOD(connect : (NSString *)ctx peer : (NSString *)peer timeoutMs : (double)timeoutMs resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LMCompletion *c = lm_promise_completion(@"waku_connect", resolve, reject);
  int rc = waku_connect(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c),
                        [peer UTF8String], (int)timeoutMs);
  if (rc != RET_OK) [c settle:rc msg:@"waku_connect returned error status"];
}

RCT_EXPORT_METHOD(relaySubscribe : (NSString *)ctx topic : (NSString *)topic resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LMCompletion *c = lm_promise_completion(@"waku_relay_subscribe", resolve, reject);
  int rc = logosdelivery_subscribe(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c),
                                   [topic UTF8String]);
  if (rc != RET_OK) [c settle:rc msg:@"subscribe returned error status"];
}

RCT_EXPORT_METHOD(relayUnsubscribe : (NSString *)ctx topic : (NSString *)topic resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LMCompletion *c = lm_promise_completion(@"waku_relay_unsubscribe", resolve, reject);
  int rc = waku_relay_unsubscribe(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c),
                                  [topic UTF8String]);
  if (rc != RET_OK) [c settle:rc msg:@"unsubscribe returned error status"];
}

RCT_EXPORT_METHOD(numConnectedPeers : (NSString *)ctx topic : (NSString *)topic resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LMCompletion *c = lm_promise_completion(@"waku_relay_get_num_connected_peers", resolve, reject);
  int rc = waku_relay_get_num_connected_peers(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c),
                                              [topic UTF8String]);
  if (rc != RET_OK) [c settle:rc msg:@"num_connected_peers returned error status"];
}

RCT_EXPORT_METHOD(storeQuery : (NSString *)ctx queryJson : (NSString *)queryJson peer : (NSString *)peer timeoutMs : (double)timeoutMs resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LMCompletion *c = lm_promise_completion(@"waku_store_query", resolve, reject);
  int rc = waku_store_query(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c),
                            [queryJson UTF8String], [peer UTF8String], (int)timeoutMs);
  if (rc != RET_OK) [c settle:rc msg:@"store_query returned error status"];
}
RCT_EXPORT_METHOD(send : (NSString *)ctx messageJson : (NSString *)messageJson resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  LMCompletion *c = lm_promise_completion(@"waku_send", resolve, reject);
  int rc = logosdelivery_send(lm_ptr(ctx), lm_request_cb, lm_retain_completion(c),
                              [messageJson UTF8String]);
  if (rc != RET_OK) [c settle:rc msg:@"send returned error status"];
}

@end
