import org.springframework.web.bind.annotation.*;

@RestController
public class CalculoController {
    @GetMapping("/calcular")
    public Object calcular(@RequestParam String a, @RequestParam String b) {
        return Double.parseDouble(a) + Double.parseDouble(b);
    }
}
