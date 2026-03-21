<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Facades\URL; // Import this at the top

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    

    public function boot(): void
    {
        // Force HTTPS if the environment is production
        if (app()->environment('production')) {
            URL::forceScheme('https');
        }
    }
}
